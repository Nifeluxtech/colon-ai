// Skills (v0.32.0): the free, open-licence skill files bundled in ./vendor/ and when each one applies.
// Each entry: the skill's folder (vendor/<pack>/<name>/SKILL.md), a short title for the "Thought process" line, the
// modes it serves, and the words that call it. Packs and licences (see vendor/<pack>/LICENSE and README.md):
//   superpowers        github.com/obra/superpowers                 MIT
//   anthropic-skills   github.com/anthropics/skills (open ones)    Apache-2.0
//   ui-ux-pro-max      github.com/nextlevelbuilder/ui-ux-pro-max-skill  MIT

const CODE = ['developer', 'workspace'];
const ALL = ['general', 'developer', 'workspace', 'study', 'research'];

const SKILLS = [
  { id: 'executing-plans', pack: 'superpowers', title: 'Executing plans', modes: CODE,
    words: /\b(execute|implement|start|continue|do|build) (the |my |this )?(plan|phase|step|task)s?\b|\bphase \d\b/i },
  { id: 'writing-plans', pack: 'superpowers', title: 'Writing plans', modes: CODE,
    words: /\b(plan|planning|roadmap|phases?|milestones?|step[- ]by[- ]step|break (it|this) down|spec|outline)\b/i },
  { id: 'brainstorming', pack: 'superpowers', title: 'Brainstorming', modes: ALL,
    words: /\b(brainstorm\w*|ideas?|what should i build|explore options|come up with|design (a|an|the) feature)\b/i },
  { id: 'systematic-debugging', pack: 'superpowers', title: 'Systematic debugging', modes: CODE,
    words: /\b(bug|debug\w*|error|exception|stack ?trace|crash\w*|broken|not working|doesn'?t work|fail(s|ing)?)\b/i },
  { id: 'test-driven-development', pack: 'superpowers', title: 'Test-driven development', modes: CODE,
    words: /\b(tdd|unit tests?|write tests?|test cases?|failing test|jest|mocha|pytest|vitest)\b/i },
  { id: 'verification-before-completion', pack: 'superpowers', title: 'Verify before done', modes: CODE,
    words: /\b(verify|double[- ]check|make sure it works|confirm it works)\b/i },
  { id: 'requesting-code-review', pack: 'superpowers', title: 'Code review', modes: CODE,
    words: /\b(review (my|this|the) (code|pr|pull request|changes?)|code review)\b/i },
  { id: 'receiving-code-review', pack: 'superpowers', title: 'Handling review feedback', modes: CODE,
    words: /\b(review (comments?|feedback)|reviewer (said|asked)|address (the )?feedback)\b/i },
  { id: 'frontend-design', pack: 'anthropic-skills', title: 'Frontend design', modes: ALL,
    words: /\b(landing page|website|web ?page|site|hero section|front-?end|html|css|beautiful|redesign)\b/i },
  { id: 'ui-ux-pro-max', pack: 'ui-ux-pro-max', title: 'UI/UX design', modes: ALL,
    words: new RegExp('\\b(ui|ux|user experience|usability|accessib\\w*|a11y|layout|typography|fonts?|colou?r palette'
      + '|mobile app design|dashboard design)\\b', 'i') },
  { id: 'ui-styling', pack: 'ui-ux-pro-max', title: 'UI styling', modes: CODE,
    words: /\b(tailwind|shadcn|styling|style (it|this|the)|css variables?|dark mode|light mode)\b/i },
  { id: 'design-system', pack: 'ui-ux-pro-max', title: 'Design system', modes: ALL,
    words: /\b(design system|design tokens?|component library|style guide)\b/i },
  { id: 'theme-factory', pack: 'anthropic-skills', title: 'Themes', modes: ALL,
    words: /\b(theme|colou?r scheme|brand colou?rs?)\b/i },
  { id: 'webapp-testing', pack: 'anthropic-skills', title: 'Web app testing', modes: CODE,
    words: /\b(playwright|e2e|end[- ]to[- ]end|browser tests?|test the (site|app|page))\b/i },
  { id: 'mcp-builder', pack: 'anthropic-skills', title: 'MCP server builder', modes: CODE,
    words: /\b(mcp|model context protocol)\b/i },
];

const SOURCES = {
  superpowers: { url: 'https://github.com/obra/superpowers', license: 'MIT' },
  'anthropic-skills': { url: 'https://github.com/anthropics/skills', license: 'Apache-2.0' },
  'ui-ux-pro-max': { url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill', license: 'MIT' },
};

module.exports = { SKILLS, SOURCES };
