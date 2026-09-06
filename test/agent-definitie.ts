// De grenstesten lazen de agent-definities eerst via een eigen parser. Sinds #547
// leest de werker diezelfde lijsten in productie (om ze als --allowedTools/
// --disallowedTools mee te geven), dus is de parser naar src/ verhuisd. De tests
// blijven via deze naam werken, maar toetsen nu exact wat de werker gebruikt.
export { leesAgentGrenzen as leesAgentFrontmatter } from '../src/agent-definitie.js';
