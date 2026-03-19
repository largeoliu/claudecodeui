import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark as prismOneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import shellSession from 'react-syntax-highlighter/dist/esm/languages/prism/shell-session';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

const SUPPORTED_LANGUAGE_LOADERS = {
  bash,
  c,
  cpp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  jsx,
  markdown,
  markup,
  python,
  rust,
  'shell-session': shellSession,
  sql,
  tsx,
  typescript,
  yaml,
} as const;

const LANGUAGE_ALIASES: Record<string, keyof typeof SUPPORTED_LANGUAGE_LOADERS | 'text'> = {
  cjs: 'javascript',
  html: 'markup',
  htm: 'markup',
  js: 'javascript',
  md: 'markdown',
  plaintext: 'text',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  svg: 'markup',
  text: 'text',
  ts: 'typescript',
  xml: 'markup',
  yml: 'yaml',
  zsh: 'bash',
};

let didRegisterLanguages = false;

function registerPrismLanguages() {
  if (didRegisterLanguages) {
    return;
  }

  Object.entries(SUPPORTED_LANGUAGE_LOADERS).forEach(([language, loader]) => {
    SyntaxHighlighter.registerLanguage(language, loader);
  });

  didRegisterLanguages = true;
}

export function normalizeCodeLanguage(language?: string) {
  const normalizedLanguage = String(language || 'text').trim().toLowerCase();
  const aliasedLanguage = LANGUAGE_ALIASES[normalizedLanguage];

  if (aliasedLanguage) {
    return aliasedLanguage;
  }

  if (normalizedLanguage in SUPPORTED_LANGUAGE_LOADERS) {
    return normalizedLanguage as keyof typeof SUPPORTED_LANGUAGE_LOADERS;
  }

  return 'text';
}

registerPrismLanguages();

export { prismOneDark, SyntaxHighlighter };
