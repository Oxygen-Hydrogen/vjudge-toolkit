import { escapeHtml } from '../client/parsers';
import { BASE_URL } from '../constants';

/**
 * 极简 Markdown 渲染器。
 * Vjudge 文章正文是 Markdown，其中 `[problem:POJ-1031]` 会被渲染成题目链接。
 */
export function renderMarkdown(markdown: string): string {
  const source = markdown.replace(/\r\n/g, '\n').trim();
  if (!source) {
    return '<p class="vj-empty">（空内容）</p>';
  }

  const codeBlocks: string[] = [];
  const withPlaceholders = source.replace(/```([a-zA-Z0-9+#-]*)\n([\s\S]*?)```/g, (_all, lang: string, code: string) => {
    const index = codeBlocks.length;
    codeBlocks.push(
      `<pre class="vj-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
    );
    return `\u0000CODE${index}\u0000`;
  });

  const lines = withPlaceholders.split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      // 保留软换行：题目清单类文章一行一条，合并成一段会看不清
      out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushQuote = () => {
    if (quote.length > 0) {
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    const codePlaceholder = line.match(/^\u0000CODE(\d+)\u0000$/);
    if (codePlaceholder) {
      flushAll();
      out.push(codeBlocks[Number(codePlaceholder[1])]);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (listType !== 'ol') {
        flushList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (listType !== 'ul') {
        flushList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();

  let html = out.join('\n');
  // 把代码块占位符替换回来（前面循环里已经直接放入，这里兜底处理内联出现的情况）
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_all, index: string) => codeBlocks[Number(index)] ?? '');
  return html;
}

function inline(text: string): string {
  let html = escapeHtml(text);

  // Vjudge 的题目引用语法：[problem:POJ-1031]
  html = html.replace(/\[problem:([^\]]+)\]/g, (_all, key: string) => {
    const href = `${BASE_URL}/problem/${encodeURIComponent(key.trim())}`;
    return `<a class="vj-prob-ref" href="${href}">${escapeHtml(key.trim())}</a>`;
  });

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code class="vj-inline-code">$1</code>');
  // 粗体 / 斜体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // 链接
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  // 图片
  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img alt="$1" src="$2">');
  // 裸链接
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<)"]+)/g, '$1<a href="$2">$2</a>');

  return html;
}
