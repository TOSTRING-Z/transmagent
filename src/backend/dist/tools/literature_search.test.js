"use strict";
/**
 * literature_search.test.ts
 * 文献查询工具测试
 */
Object.defineProperty(exports, "__esModule", { value: true });
const literature_search_1 = require("./literature_search");
describe('Literature Search Tool', () => {
    describe('Tool Metadata', () => {
        it('should have correct tool name', () => {
            expect(literature_search_1.literatureSearchTool.name).toBe('literature_search');
        });
        it('should have proper description', () => {
            expect(literature_search_1.literatureSearchTool.description).toBeTruthy();
            expect(literature_search_1.literatureSearchTool.description.length).toBeGreaterThan(20);
        });
        it('should have valid parameters schema', () => {
            expect(literature_search_1.literatureSearchTool.parameters.type).toBe('object');
            expect(literature_search_1.literatureSearchTool.parameters.properties).toBeDefined();
            expect(literature_search_1.literatureSearchTool.parameters.properties.query).toBeDefined();
        });
    });
    describe('Search Functionality', () => {
        it('should accept basic query', async () => {
            const result = await (0, literature_search_1.literatureSearch)({ query: 'machine learning' });
            expect(result).toBeDefined();
            expect(result.query).toBe('machine learning');
        });
        it('should return results structure', async () => {
            const result = await (0, literature_search_1.literatureSearch)({ query: 'deep learning', maxResults: 5 });
            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('totalFound');
            expect(result).toHaveProperty('results');
            expect(result).toHaveProperty('query');
            expect(result).toHaveProperty('searchTime');
            expect(result).toHaveProperty('sources');
            expect(Array.isArray(result.results)).toBe(true);
        });
        it('should respect maxResults limit', async () => {
            const result = await (0, literature_search_1.literatureSearch)({ query: 'neural network', maxResults: 3 });
            expect(result.results.length).toBeLessThanOrEqual(3);
        });
        it('should handle source parameter', async () => {
            const sources = ['pubmed', 'arxiv', 'semantic', 'crossref'];
            for (const source of sources) {
                const result = await (0, literature_search_1.literatureSearch)({
                    query: 'protein folding',
                    maxResults: 2,
                    source
                });
                expect(result).toBeDefined();
                expect(result.success).toBe(true);
            }
        });
    });
    describe('Result Processing', () => {
        it('should deduplicate results by DOI or title', async () => {
            const result = await (0, literature_search_1.literatureSearch)({ query: 'transformer attention', maxResults: 10 });
            const titles = result.results.map(r => r.title);
            const uniqueTitles = new Set(titles);
            expect(uniqueTitles.size).toBe(titles.length);
        });
        it('should include essential fields in results', async () => {
            const result = await (0, literature_search_1.literatureSearch)({ query: 'CRISPR', maxResults: 3 });
            if (result.results.length > 0) {
                const firstResult = result.results[0];
                expect(firstResult).toHaveProperty('id');
                expect(firstResult).toHaveProperty('title');
                expect(firstResult).toHaveProperty('authors');
                expect(firstResult).toHaveProperty('source');
                expect(Array.isArray(firstResult.authors)).toBe(true);
            }
        });
    });
    describe('Error Handling', () => {
        it('should handle empty query gracefully', async () => {
            const result = await (0, literature_search_1.literatureSearch)({ query: '' });
            expect(result).toBeDefined();
        });
        it('should handle very long query', async () => {
            const longQuery = 'test '.repeat(100);
            const result = await (0, literature_search_1.literatureSearch)({ query: longQuery, maxResults: 2 });
            expect(result).toBeDefined();
        });
    });
});
//# sourceMappingURL=literature_search.test.js.map