import { factoryEslint } from './configs/eslint.js';

export default factoryEslint({
  tsconfigRootDir: import.meta.dirname,
  // Het skeleton is een sjabloon met placeholders en heeft geen eigen
  // TypeScript-project; het wordt gelint in de applicatie die eruit ontstaat.
  extraIgnores: ['skeleton/**'],
});
