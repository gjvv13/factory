export interface BackupOpties {
    /** Hoeveel generaties bewaard blijven (nieuwste eerst). Standaard 7. */
    readonly bewaar?: number;
    /** Injecteerbaar zodat de bestandsnaam in tests deterministisch is. */
    readonly nu?: Date;
}
/**
 * Maakt een consistente, terughaalbare kopie van de SQLite-database van een
 * omgeving en houdt een paar generaties historie. Consistent via `sqlite3 .backup`
 * (veilig ook met een levend WAL-bestand), niet een kale `cp`. De backups belanden
 * in `<werkmap>/backups/`; off-site kopiëren is een losse stap (slice 3).
 */
export declare function backup(omgevingArgument: string | undefined, opties?: BackupOpties): void;
