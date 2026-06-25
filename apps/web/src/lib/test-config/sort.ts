export interface NameSortableConfig {
    name: string;
}

export function compareConfigsByName<T extends NameSortableConfig>(a: T, b: T): number {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
