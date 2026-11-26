// Run with the desktop read_thread tool. Only public chat messages enter the index.
module.exports = async function readHistory(readThread, source) {
  const limits = { turnLimit: 10, itemLimit: 100, maxOutputCharsPerItem: 20000, includeOutputs: false };
  const pages = [];
  const newestTurns = [];
  const turnIds = new Set();

  async function fetchPage(position) {
    const result = await readThread({ ...source, ...limits, ...position });
    if (result.isError) throw new Error(result.content?.[0]?.text || 'read_thread failed');
    const page = result.structuredContent ?? JSON.parse(result.content[0].text);
    if (page.thread?.id && page.thread.id !== source.threadId) throw new Error('Source chat changed');
    return page;
  }

  function messages(items, turnId, position) {
    if (!Array.isArray(items)) throw new Error('Missing items in chat history');
    const pageNumber = pages.length;
    const records = [];
    for (const item of items) {
      if (item.type !== 'userMessage' && item.type !== 'agentMessage') continue;
      const user = item.type === 'userMessage';
      const parts = user && Array.isArray(item.content) ? item.content : [];
      const blocks = parts.filter(p => typeof p.text === 'string').map(p => p.text);
      const text = user ? blocks.join('\n') : (item.text ?? '');
      const attachments = parts.filter(p => p.type !== 'text').map(p => p.type);
      const clipped = Object.keys(item).some(k => /truncated/i.test(k) && item[k] === true)
        || parts.some(p => p.truncated || p.textTruncated) || text.length >= limits.maxOutputCharsPerItem;
      records.push({ role: user ? 'user' : 'assistant', turn: turnId, item: item.id,
        page: pageNumber, phase: item.phase, text, attachments, checkOriginal: Boolean(clipped || attachments.length || !text) });
    }
    if (records.length) pages.push(position);
    return records;
  }

  let cursor;
  const seenPages = new Set();
  do {
    const position = cursor ? { cursor } : {};
    const page = await fetchPage(position);
    if (!Array.isArray(page.turns) || !page.page) throw new Error('Unrecognized turn history');
    if (page.page.order && page.page.order !== 'newest_first') throw new Error('Unexpected turn order');
    for (const turn of page.turns) {
      if (turnIds.has(turn.id)) throw new Error('Repeated turn in history');
      turnIds.add(turn.id);
      const groups = [messages(turn.items, turn.id, position)];
      let itemCursor = turn.nextItemCursor;
      const seenItems = new Set();
      while (itemCursor) {
        if (seenItems.has(itemCursor)) throw new Error('Repeated item cursor');
        seenItems.add(itemCursor);
        const older = await fetchPage({ itemCursor });
        groups.push(messages(older.items, turn.id, { itemCursor }));
        itemCursor = older.nextItemCursor;
      }
      newestTurns.push(groups.reverse().flat());
    }
    cursor = page.page.nextCursor;
    if (page.page.hasMore && !cursor) throw new Error('Incomplete turn history');
    if (cursor && seenPages.has(cursor)) throw new Error('Repeated turn cursor');
    seenPages.add(cursor);
  } while (cursor);
  return { source, limits, pages, turnCount: turnIds.size, messages: newestTurns.reverse().flat() };
};
