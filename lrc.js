// LRC parsing. Handles multi-timestamp lines, [offset:], two- and
// three-digit fractions, and keeps empty timed lines — they are the
// instrumental gaps, and dropping them desynchronises everything after.

export function parseLrc(content) {
  const lines = content.split('\n');
  let offset = 0;
  const parsedLines = [];
  let hasTimestamps = false;

  const timeRegex = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const offsetMatch = line.match(/\[offset:\s*([\+\-]?\d+)\]/i);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10) / 1000;
      break;
    }
  }

  for (const line of lines) {
    const rawText = line.replace(timeRegex, '').replace(/\[\w+:[^\]]*\]/g, '').trim();
    
    const timeMatches = [...line.matchAll(timeRegex)];
    if (timeMatches.length > 0) {
      hasTimestamps = true;
      for (const match of timeMatches) {
        const mins = parseInt(match[1], 10);
        const secs = parseInt(match[2], 10);
        let msStr = match[3] || '00';
        if (msStr.length === 2) msStr += '0';
        const ms = parseInt(msStr, 10);
        
        let time = mins * 60 + secs + ms / 1000;
        time += offset;
        
        parsedLines.push({ time, text: rawText });
      }
    } else {
      if (rawText && !line.match(/^\[\w+:/)) {
         parsedLines.push({ time: -1, text: rawText });
      }
    }
  }

  if (hasTimestamps) {
    const timed = parsedLines.filter(l => l.time >= 0);
    timed.sort((a, b) => a.time - b.time);
    return { synced: true, lines: timed };
  } else {
    return { synced: false, lines: parsedLines.filter(l => l.text) };
  }
}
