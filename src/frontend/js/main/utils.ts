export function getFileName(path: string): string {
  return path.split('/').pop()!.split('\\').pop()!;
}

export function getTokens(text: string): number {
  const normalizedText = text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');

  const chineseTokens = normalizedText.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g) || [];
  const wordTokens = normalizedText.match(/[a-zA-Z_][a-zA-Z0-9_]*|\+\+|--|&&|\|\||[<>!=]=?|\d+\.?\d*|[^\s\u4e00-\u9fa5]/g) || [];

  return chineseTokens.length + wordTokens.length;
}

export function createElement(html: string): HTMLElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.firstChild as HTMLElement;
}

export function getIcon(is_plugin: boolean): string {
  return is_plugin ? "api" : "ai";
}

export function formatString(template: string, params: any): HTMLElement {
  const formattedText = template.replace(/@(\w+)/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return params[key];
    } else {
      console.warn(`Key "${key}" not found in params`);
      return match;
    }
  });
  return createElement(formattedText);
}
