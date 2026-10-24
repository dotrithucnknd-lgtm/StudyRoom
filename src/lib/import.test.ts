import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, parseImport } from './import.ts';

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
test('import defaults (tab + new line) accept Unicode pairs', () => {
  const rows = parseImport('言葉\ttừ ngữ\r\nありがとう\tcảm ơn\n\n', { term: 'tab', card: 'newline' });
  assert.deepEqual(rows, [{ term: '言葉', definition: 'từ ngữ' }, { term: 'ありがとう', definition: 'cảm ơn' }]);
});
test('import splits only on the first term separator', () => {
  assert.deepEqual(parseImport('hello,xin chào, bạn', { term: 'comma', card: 'newline' }), [{ term: 'hello', definition: 'xin chào, bạn' }]);
});
test('import supports semicolon and custom separators with multi-line definitions', () => {
  assert.deepEqual(parseImport('a - một;b - hai', { term: 'custom', customTerm: ' - ', card: 'semicolon' }).map(r => r.definition), ['một', 'hai']);
  const rows = parseImport('apple: quả táo\nmàu đỏ\n\nbook: sách', { term: 'custom', customTerm: ':', card: 'custom', customCard: '\\n\\n' });
  assert.equal(rows[0].definition, 'quả táo\nmàu đỏ');
  assert.equal(rows[1].term, 'book');
});
test('import exposes missing definitions', () => {
  assert.equal(parseImport('unfinished', { term: 'tab', card: 'newline' })[0].definition, '');
});
