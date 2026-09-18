/**
 * The rules, rendered inside the app.
 *
 * ## Why this is not a link
 *
 * "Rules" was an anchor to /docs/how-nim-rush-works.md. That works in dev,
 * where Vite serves the repository root, and does not work anywhere else: the
 * file is not deployed, so production's single-page fallback answers the
 * request with index.html and a 200. The browser then loads the app again and
 * the rider lands back on the start screen, having read nothing and lost
 * whatever they were doing. A 404 would at least have been honest; a 200 that
 * quietly restarts the game is the worst version of that bug.
 *
 * Opening a tab was the wrong idea regardless. This runs inside Nimiq Pay,
 * where leaving the app is awkward and coming back is worse.
 *
 * ## Why the markdown is bundled rather than fetched
 *
 * docs/how-nim-rush-works.md is the canonical rules document, and a test
 * asserts it carries the prize split. Importing it as text keeps one source:
 * the doc a maintainer edits is the screen a rider reads, with no build step to
 * forget and no request to fail. The renderer below covers only the syntax that
 * document actually uses - headings, bold, tables, lists, paragraphs - because
 * a general markdown parser is a dependency this does not need.
 */
import rulesMarkdown from '../../../docs/how-nim-rush-works.md?raw';

/** Inline `**bold**`, which is all the emphasis the document uses. */
function inline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const [index, part] of text.split(/\*\*/).entries()) {
    if (part === '') continue;
    if (index % 2 === 1) {
      const strong = document.createElement('strong');
      strong.textContent = part;
      fragment.append(strong);
    } else {
      fragment.append(document.createTextNode(part));
    }
  }
  return fragment;
}

function cells(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

/** A table is a header row, a divider of dashes, then body rows. */
function isDivider(line: string): boolean {
  return /^\|[\s|:-]+\|$/.test(line.trim());
}

/**
 * Render the rules document into a container.
 *
 * Returns the element so a caller can append it; it never touches the DOM
 * outside what it builds.
 */
export function createBlitzRulesBody(markdown: string = rulesMarkdown): HTMLElement {
  const body = document.createElement('div');
  body.className = 'blitz-rules-body';
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: HTMLUListElement | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const p = document.createElement('p');
    p.append(inline(paragraph.join(' ')));
    body.append(p);
    paragraph = [];
  };
  const flushList = () => { list = null; };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();

    if (trimmed === '') { flushParagraph(); flushList(); continue; }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(); flushList();
      // The document's own H1 is the screen's title, so it is not repeated here.
      const level = heading[1]!.length;
      if (level === 1) continue;
      const element = document.createElement(level === 2 ? 'h2' : 'h3');
      element.append(inline(heading[2]!));
      body.append(element);
      continue;
    }

    if (trimmed.startsWith('|') && isDivider(lines[index + 1] ?? '')) {
      flushParagraph(); flushList();
      const table = document.createElement('table');
      table.className = 'blitz-rules-table';
      const head = document.createElement('tr');
      for (const cell of cells(trimmed)) {
        const th = document.createElement('th');
        th.append(inline(cell));
        head.append(th);
      }
      table.append(head);
      index += 1;
      while (index + 1 < lines.length && (lines[index + 1] ?? '').trim().startsWith('|')) {
        index += 1;
        const row = document.createElement('tr');
        for (const cell of cells(lines[index]!.trim())) {
          const td = document.createElement('td');
          td.append(inline(cell));
          row.append(td);
        }
        table.append(row);
      }
      body.append(table);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (!list) { list = document.createElement('ul'); list.className = 'blitz-rules-list'; body.append(list); }
      const item = document.createElement('li');
      item.append(inline(bullet[1]!));
      list.append(item);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  return body;
}
