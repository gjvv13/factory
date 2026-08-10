export interface BackupOpties {
    /** Hoeveel generaties bewaard blijven (nieuwste eerst). Standaard 7. */
    readonly bewaar?: number;
    /**
     * Map buiten de Mac (bijv. een externe schijf) waar de verse backup óók heen gaat,
     * mét eigen rotatie. Is de schijf niet aangesloten, dan slaan we deze stap over met
     * een waarschuwing in plaats van de hele backup te laten falen.
     */
    readonly offsiteDir?: string;
    /** Injecteerbaar zodat de bestandsnaam in tests deterministisch is. */
    readonly nu?: Date;
}
/**
 * Maakt een consistente, terughaalbare kopie van de SQLite-database van een
 * omgeving en houdt een paar generaties historie. Consistent via `sqlite3 .backup`
 * (veilig ook met een levend WAL-bestand), niet een kale `cp`. De backups belanden
 * in `<werkmap>/backups/`; met `offsiteDir` gaat de verse kopie er óók buiten de Mac
 * heen.
 */
export declare function backup(omgevingArgument: string | undefined, opties?: BackupOpties): void;
