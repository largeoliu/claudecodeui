import { parseFrontmatter } from '../../../server/utils/frontmatter.js';

describe('frontmatter parser', () => {
  it('parses standard YAML frontmatter', () => {
    const result = parseFrontmatter('---\ntitle: Demo\ntags:\n  - tests\n---\nHello');

    expect(result.data).toEqual({ title: 'Demo', tags: ['tests'] });
    expect(result.content.trim()).toBe('Hello');
  });

  it('returns plain content when there is no frontmatter', () => {
    const result = parseFrontmatter('Just content');

    expect(result.data).toEqual({});
    expect(result.content).toBe('Just content');
  });

  it('does not evaluate JavaScript frontmatter engines', () => {
    const result = parseFrontmatter('---javascript\nmodule.exports = { title: "Owned" }\n---\nBody');

    expect(result.data).toEqual({});
    expect(result.content.trim()).toBe('Body');
  });
});
