import type { AppData, Card, SetRecord } from './types';
const now = new Date().toISOString();
const list = [
  ['serendipity', 'tình cờ tìm thấy điều tốt đẹp', '/ˌser.ənˈdɪp.ɪ.ti/', 'Finding that little bookstore was pure serendipity.'],
  ['resilient', 'kiên cường, có khả năng phục hồi', '/rɪˈzɪl.i.ənt/', 'She remained resilient through every challenge.'],
  ['nuance', 'sắc thái tinh tế', '/ˈnuː.ɑːns/', 'There is a nuance in meaning between the two words.'],
  ['eloquent', 'hùng biện, diễn đạt lưu loát', '/ˈel.ə.kwənt/', 'His eloquent speech moved the audience.'],
  ['wanderlust', 'niềm đam mê du lịch', '/ˈwɑːn.dɚ.lʌst/', 'Her wanderlust led her across the world.'],
  ['meticulous', 'tỉ mỉ, cẩn thận', '/məˈtɪk.jə.ləs/', 'He kept meticulous notes during the lecture.'],
  ['ephemeral', 'phù du, ngắn ngủi', '/ɪˈfem.ər.əl/', 'The beauty of cherry blossoms is ephemeral.'],
  ['empathy', 'sự đồng cảm', '/ˈem.pə.θi/', 'Empathy helps us understand one another.'],
  ['curiosity', 'sự tò mò', '/ˌkjʊr.iˈɑː.sə.ti/', 'Curiosity is the beginning of discovery.'],
  ['flourish', 'phát triển mạnh mẽ', '/ˈflɝː.ɪʃ/', 'Ideas flourish when people collaborate.'],
  ['perspective', 'góc nhìn, quan điểm', '/pɚˈspek.tɪv/', 'Try to see the problem from another perspective.'],
  ['ambitious', 'đầy tham vọng', '/æmˈbɪʃ.əs/', 'She set an ambitious goal for this year.']
];
export const demoData: AppData = {
  profile: { id: 'demo', display_name: 'Bạn học', learning_language: 'Tiếng Anh', daily_goal: 20 },
  sets: [
    { id: 'demo-1', owner_id: 'demo', title: 'Everyday English', description: 'Những từ vựng giàu sắc thái cho cuộc sống hằng ngày.', source_language: 'English', target_language: 'Tiếng Việt', folder_id: null, visibility: 'private', tags: ['Giao tiếp', 'B1–B2'], cover_color: 'violet', created_at: now, updated_at: now, card_count: 12, mastered_count: 3 },
    { id: 'demo-2', owner_id: 'demo', title: 'Japanese Essentials', description: 'Từ và cụm từ tiếng Nhật dùng mỗi ngày.', source_language: '日本語', target_language: 'Tiếng Việt', folder_id: null, visibility: 'private', tags: ['Tiếng Nhật'], cover_color: 'peach', created_at: now, updated_at: now, card_count: 5, mastered_count: 0 },
    { id: 'demo-3', owner_id: 'demo', title: 'Business Vocabulary', description: 'Xây dựng vốn từ cho công việc và sự nghiệp.', source_language: 'English', target_language: 'Tiếng Việt', folder_id: null, visibility: 'private', tags: ['Công việc'], cover_color: 'mint', created_at: now, updated_at: now, card_count: 5, mastered_count: 0 }
  ],
  cards: [
    ...list.map((row, i): Card => ({ id: `demo-card-${i}`, set_id: 'demo-1', term: row[0], definition: row[1], phonetic: row[2], example: row[3], example_translation: '', notes: '', synonyms: '', antonyms: '', tags: [], favorite: i === 0, difficult: i === 5, mastered: i < 3, position: i })),
    ...[['こんにちは', 'xin chào'], ['ありがとう', 'cảm ơn'], ['はじめまして', 'rất vui được gặp bạn'], ['勉強', 'học tập'], ['言葉', 'từ ngữ']].map((row, i): Card => ({ id: `demo-jp-${i}`, set_id: 'demo-2', term: row[0], definition: row[1], phonetic: '', example: '', example_translation: '', notes: '', synonyms: '', antonyms: '', tags: [], favorite: false, difficult: false, mastered: false, position: i })),
    ...[['collaborate', 'hợp tác'], ['strategy', 'chiến lược'], ['deadline', 'hạn chót'], ['insight', 'sự hiểu biết sâu sắc'], ['milestone', 'cột mốc']].map((row, i): Card => ({ id: `demo-biz-${i}`, set_id: 'demo-3', term: row[0], definition: row[1], phonetic: '', example: '', example_translation: '', notes: '', synonyms: '', antonyms: '', tags: [], favorite: false, difficult: false, mastered: false, position: i }))
  ], sessions: [], folders: []
};
