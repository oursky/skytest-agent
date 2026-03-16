const VARIABLE_REGEX = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const FILE_REF_REGEX = /\{\{file:([^}]+)\}\}/g;

export function substituteVariables(text: string, variables: Record<string, string>): string {
    return text.replace(VARIABLE_REGEX, (match, name: string) => {
        if (name in variables) {
            return variables[name];
        }
        return match;
    });
}

export function substituteFileReferences(text: string, files: Record<string, string>): string {
    return text.replace(FILE_REF_REGEX, (match, filename: string) => {
        if (filename in files) {
            return files[filename];
        }
        return match;
    });
}

export function substituteAll(text: string, variables: Record<string, string>, files: Record<string, string>): string {
    let result = substituteVariables(text, variables);
    result = substituteFileReferences(result, files);
    return result;
}
