import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, parseQuizletPaste } from './import.ts';

test('CSV retains Vietnamese, Japanese and quoted commas', () => {
  const rows = parseDelimited('term,definition,example\r\nこんにちは,"xin chào, thân mật","こんにちは、友達！"\r\nserendipity,sự tình cờ,"A happy, unexpected find"');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].term, 'こんにちは');
  assert.equal(rows[0].definition, 'xin chào, thân mật');
  assert.equal(rows[1].example, 'A happy, unexpected find');
});
test('TSV recognizes Vietnamese headers', () => {
  const rows = parseDelimited('Từ\tNghĩa\tPhiên âm\n勉強\thọc tập\tべんきょう');
  assert.equal(rows[0].definition, 'học tập');
  assert.equal(rows[0].phonetic, 'べんきょう');
});
test('malformed quoted CSV is rejected before import', () => {
  assert.throws(() => parseDelimited('term,definition\n"unfinished,word'));
});
test('Quizlet paste accepts tab-separated Unicode pairs', () => {
  const rows = parseQuizletPaste('言葉\ttừ ngữ\nありがとう\tcảm ơn');
  assert.deepEqual(rows.map(row => [row.term, row.definition]), [['言葉', 'từ ngữ'], ['ありがとう', 'cảm ơn']]);
});
test('Quizlet paste accepts dash and colon separators and exposes missing definitions', () => {
  assert.equal(parseQuizletPaste('resilient - kiên cường', 'dash')[0].definition, 'kiên cường');
  assert.equal(parseQuizletPaste('empathy: sự đồng cảm', 'colon')[0].term, 'empathy');
  assert.equal(parseQuizletPaste('unfinished', 'colon')[0].definition, '');
});
