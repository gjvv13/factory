/**
 * Vitest setup-bestand dat uitgaand netwerkverkeer naar niet-localhost-adressen
 * blokkeert in e2e-tests. Importeer dit bestand niet rechtstreeks; het wordt
 * automatisch als setupFile geladen door de e2e-preset.
 *
 * Apps die de guard los willen gebruiken kunnen het als setupFile opnemen:
 *   setupFiles: [require.resolve('@gjvv13/factory/e2e-network-guard')]
 */
export {};
