#!/usr/bin/env node
// Bomi AI QA harness.
//
// Usage:
//   GEMINI_API_KEY=... node qa/run-qa.mjs                          # real run, default provider (Gemini free tier)
//   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... node qa/run-qa.mjs   # real run against Claude
//   QA_MOCK=1 node qa/run-qa.mjs                                   # offline wiring smoke test (fake scores)
//
// What it does: for each elderly persona (qa/personas.mjs) it runs each
// applicable multi-turn scenario (qa/scenarios.mjs) through the exact same
// system-prompt logic production uses (qa/lib/systemPrompt.mjs, kept in sync
// with index.html's systemPrompt()), then asks a separate LLM-judge call to
// score the transcript against criteria lifted straight from the pitch deck's
// promises (qa/rubric.mjs). It also runs a dedicated "greeting variety" probe
// per persona to check for the exact complaint captured on slide 11
// ("아침마다 너무 형식적인 것만 얘기해").
//
// Output: a Markdown report under qa/reports/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { personas } from './personas.mjs';
import { SCENARIOS, GREETING_VARIETY_OPENERS } from './scenarios.mjs';
import { CRITERIA, PASS_THRESHOLD } from './rubric.mjs';
import { buildSystemPrompt } from './lib/systemPrompt.mjs';
import { callBomiApi, currentProvider } from './lib/callBomiApi.mjs';
import { judgeConversation, judgeGreetingVariety } from './lib/judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runScenarioForPersona(persona, scenario) {
  const system = buildSystemPrompt(persona.profile, persona.checklistItems, persona.checklistState);
  const transcript = [];
  for (const userText of scenario.turns) {
    transcript.push({ role: 'user', content: userText });
    const reply = await callBomiApi(system, transcript.slice(-10));
    transcript.push({ role: 'assistant', content: reply });
  }
  const judged = await judgeConversation({
    personaLabel: `${persona.profile.name} (${persona.notes})`,
    transcript,
    criteriaIds: scenario.criteria,
  });
  return { transcript, judged };
}

async function runGreetingVarietyForPersona(persona) {
  const system = buildSystemPrompt(persona.profile, persona.checklistItems, persona.checklistState);
  const replies = [];
  for (const opener of GREETING_VARIETY_OPENERS) {
    const reply = await callBomiApi(system, [{ role: 'user', content: opener }]);
    replies.push(reply);
  }
  const judged = await judgeGreetingVariety({ personaLabel: persona.profile.name, openers: GREETING_VARIETY_OPENERS, replies });
  return { replies, judged };
}

function verdictFor(score) {
  if (score == null) return '⚠️ 판정불가';
  return score >= PASS_THRESHOLD ? '✅ PASS' : '❌ FAIL';
}

function buildMarkdownReport(results, greetingResults, isMock) {
  const lines = [];
  lines.push('# 보미 AI QA 리포트');
  lines.push('');
  lines.push(`- 생성 시각: ${new Date().toLocaleString('ko-KR')}`);
  lines.push(`- 모드: ${isMock ? '⚠️ MOCK (배선 확인용 가짜 점수 — 실제 QA 판정으로 쓰지 마세요)' : `실제 API 호출 (provider: ${currentProvider()})`}`);
  lines.push('');

  lines.push('## 요약 — 시나리오별');
  lines.push('');
  lines.push('| 어르신 | 시나리오 | 슬라이드 | 기준 미달 항목 |');
  lines.push('|---|---|---|---|');
  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.personaName} | ${r.scenarioTitle} | ${r.slideRef} | ⚠️ 실행 오류: ${r.error} |`);
      continue;
    }
    const failed = Object.entries(r.judged.scores || {})
      .filter(([, v]) => (v.score ?? 0) < PASS_THRESHOLD)
      .map(([id]) => id);
    lines.push(`| ${r.personaName} | ${r.scenarioTitle} | ${r.slideRef} | ${failed.length ? failed.join(', ') : '없음 ✅'} |`);
  }
  lines.push('');

  lines.push('## 요약 — 인사 다양성 (슬라이드 11 재현)');
  lines.push('');
  lines.push('| 어르신 | 점수(1~5, 낮을수록 형식적) | 판정 |');
  lines.push('|---|---|---|');
  for (const g of greetingResults) {
    if (g.error) {
      lines.push(`| ${g.personaName} | ⚠️ 실행 오류 | - |`);
      continue;
    }
    lines.push(`| ${g.personaName} | ${g.judged.score ?? '판정불가'} | ${verdictFor(g.judged.score)} |`);
  }
  lines.push('');

  lines.push('## 상세 결과 — 시나리오');
  for (const r of results) {
    lines.push(`### ${r.personaName} — ${r.scenarioTitle} (슬라이드 ${r.slideRef})`);
    if (r.error) {
      lines.push(`실행 오류: ${r.error}`);
      lines.push('');
      continue;
    }
    lines.push('');
    lines.push('**대화 기록**');
    lines.push('```');
    for (const t of r.transcript) lines.push(`${t.role === 'user' ? '어르신' : '보미'}: ${t.content}`);
    lines.push('```');
    lines.push('');
    lines.push('**채점**');
    for (const [id, v] of Object.entries(r.judged.scores || {})) {
      const crit = CRITERIA.find(c => c.id === id);
      lines.push(`- ${verdictFor(v.score)} ${crit ? crit.label : id} (${v.score}/5): ${v.reason}`);
    }
    if (r.judged.flagged_quotes && r.judged.flagged_quotes.length) {
      lines.push(`- 🚩 문제 문장: ${r.judged.flagged_quotes.join(' / ')}`);
    }
    if (r.judged.parseError) {
      lines.push(`- ⚠️ 채점 응답 파싱 실패, 원문: ${r.judged.parseError}`);
    }
    lines.push('');
  }

  lines.push('## 상세 결과 — 인사 다양성');
  for (const g of greetingResults) {
    lines.push(`### ${g.personaName}`);
    if (g.error) {
      lines.push(`실행 오류: ${g.error}`);
      lines.push('');
      continue;
    }
    g.replies.forEach((reply, i) => lines.push(`- "${GREETING_VARIETY_OPENERS[i]}" → "${reply}"`));
    lines.push(`- 판정: ${verdictFor(g.judged.score)} (${g.judged.score ?? '판정불가'}/5) — ${g.judged.reason ?? ''}`);
    if (g.judged.parseError) lines.push(`- ⚠️ 채점 응답 파싱 실패, 원문: ${g.judged.parseError}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const isMock = process.env.QA_MOCK === '1';
  const personaFilter = process.env.QA_PERSONA; // e.g. "kimMalsoon" to run just one persona (cheaper iteration)
  const scenarioFilter = process.env.QA_SCENARIO; // e.g. "medication_reminder_recall"
  const activePersonas = personaFilter ? personas.filter(p => p.id === personaFilter) : personas;
  const activeScenarios = scenarioFilter ? SCENARIOS.filter(s => s.id === scenarioFilter) : SCENARIOS;
  if (personaFilter && activePersonas.length === 0) throw new Error(`QA_PERSONA="${personaFilter}"에 해당하는 페르소나가 없습니다.`);
  if (scenarioFilter && activeScenarios.length === 0) throw new Error(`QA_SCENARIO="${scenarioFilter}"에 해당하는 시나리오가 없습니다.`);

  console.log(`\n보미 AI QA 하네스 시작 ${isMock ? '(MOCK 모드 - 실제 API 호출 없음, 점수는 가짜입니다)' : `(provider: ${currentProvider()})`}\n`);

  const results = [];
  for (const persona of activePersonas) {
    for (const scenario of activeScenarios) {
      if (scenario.personaFilter && !scenario.personaFilter(persona)) continue;
      process.stdout.write(`  - ${persona.profile.name} x ${scenario.title} ... `);
      try {
        const r = await runScenarioForPersona(persona, scenario);
        results.push({ personaId: persona.id, personaName: persona.profile.name, scenarioId: scenario.id, scenarioTitle: scenario.title, slideRef: scenario.slideRef, ...r });
        console.log('완료');
      } catch (e) {
        console.log(`오류: ${e.message}`);
        results.push({ personaId: persona.id, personaName: persona.profile.name, scenarioId: scenario.id, scenarioTitle: scenario.title, slideRef: scenario.slideRef, error: e.message });
      }
    }
  }

  const greetingResults = [];
  for (const persona of activePersonas) {
    process.stdout.write(`  - ${persona.profile.name} x 인사 다양성 체크 ... `);
    try {
      const r = await runGreetingVarietyForPersona(persona);
      greetingResults.push({ personaId: persona.id, personaName: persona.profile.name, ...r });
      console.log('완료');
    } catch (e) {
      console.log(`오류: ${e.message}`);
      greetingResults.push({ personaId: persona.id, personaName: persona.profile.name, error: e.message });
    }
  }

  const report = buildMarkdownReport(results, greetingResults, isMock);
  const outDir = path.join(__dirname, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `qa-report-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(outPath, report, 'utf-8');
  console.log(`\n리포트 저장됨: ${outPath}\n`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
