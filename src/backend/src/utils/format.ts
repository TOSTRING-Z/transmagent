export function formatString(template: string, data: Record<string, any>): string {
    return template.replace(/(\{.*?\})/g, (match) => {
        try {
            const keys = Object.keys(data);
            const values = Object.values(data);
            return new Function(...keys, `return \`$${match}\`;`)(...values);
        } catch (e: any) {
            console.error(`Format error: ${e.message}`);
            return match;
        }
    });
}