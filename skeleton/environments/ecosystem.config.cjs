/*
 * pm2-definitie van de drie omgevingen van deze applicatie.
 * De configuratie komt uit environments/<omgeving>.env en factory.json, zodat
 * die bestanden de enige plek zijn waar omgevingswaarden staan.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'factory.json'), 'utf8'));

function envRootPad() {
  const ruw = appConfig.envRoot;
  return ruw.startsWith('~') ? path.join(os.homedir(), ruw.slice(1)) : path.resolve(repoRoot, ruw);
}

function leesEnvBestand(bestand) {
  const resultaat = {};
  if (!fs.existsSync(bestand)) return resultaat;
  for (const regel of fs.readFileSync(bestand, 'utf8').split('\n')) {
    const getrimd = regel.trim();
    if (getrimd === '' || getrimd.startsWith('#')) continue;
    const scheiding = getrimd.indexOf('=');
    if (scheiding === -1) continue;
    resultaat[getrimd.slice(0, scheiding)] = getrimd.slice(scheiding + 1);
  }
  return resultaat;
}

// Platform-brede gedeelde secrets-laag: één bestand in de oudermap van envRoot
// (~/AppEnvs/shared.secrets.env) dat élke app meeleest, buiten git. Eén plek om een
// credential (zoals een GitHub-PAT) te zetten en te roteren (#517). Ontbreekt het
// bestand, dan is dit een no-op (leesEnvBestand geeft {}).
function gedeeldSecretsPad() {
  return path.join(path.dirname(envRootPad()), 'shared.secrets.env');
}

function omgevingsWaarden(naam) {
  const map = path.join(repoRoot, 'environments');
  return {
    ...leesEnvBestand(path.join(map, `${naam}.env`)),
    // Gedeelde platform-secrets: tussen de per-app env en de per-app secrets, zodat een
    // per-app secret altijd wint en een gedeelde waarde nooit een bewuste per-app secret.
    ...leesEnvBestand(gedeeldSecretsPad()),
    // Waarden die niet in git horen (tokens, sleutels) komen hier vandaan.
    ...leesEnvBestand(path.join(map, `${naam}.secrets.env`)),
  };
}

function app(naam, cwd, vanuitBron) {
  return {
    name: `${appConfig.naam}-${naam}`,
    cwd,
    script: vanuitBron ? 'app/src/main.ts' : 'dist/main.js',
    interpreter: 'node',
    ...(vanuitBron ? { interpreter_args: '--import tsx' } : {}),
    env: { ...omgevingsWaarden(naam), ROOT_DIR: cwd },
    autorestart: true,
    max_restarts: 10,
    restart_delay: 2000,
    out_file: path.join(repoRoot, 'logs', `${naam}-out.log`),
    error_file: path.join(repoRoot, 'logs', `${naam}-error.log`),
    merge_logs: true,
    time: true,
  };
}

module.exports = {
  apps: [
    // dev draait rechtstreeks op de bronbestanden in de repo.
    app('dev', repoRoot, true),
    // acc en prod draaien op een gebouwde release-tag in een eigen clone.
    app('acc', path.join(envRootPad(), 'acc'), false),
    app('prod', path.join(envRootPad(), 'prod'), false),
  ],
};
