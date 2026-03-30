/**
 * literature_search.ts
 * 全面最新文献查询工具
 * 支持多源学术数据库查询，自动提取论文元数据
 */

import { logger } from '../utils/logger';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

// --- 类型定义 ---
export interface LiteratureResult {
    id: string;
    title: string;
    authors: string[];
    abstract: string;
    publicationDate: string;
    journal: string;
    doi: string;
    url: string;
    citations: number;
    source: string;
    keywords: string[];
}

export interface LiteratureSearchParams {
    query: string;
    maxResults?: number;           // 最大返回数量，默认20
    dateFrom?: string;             // 开始日期 YYYY-MM-DD
    dateTo?: string;               // 结束日期 YYYY-MM-DD
    source?: 'all' | 'pubmed' | 'arxiv' | 'semantic' | 'crossref';  // 数据源
    sortBy?: 'relevance' | 'date';  // 排序方式
}

export interface LiteratureSearchResult {
    success: boolean;
    totalFound: number;
    results: LiteratureResult[];
    query: string;
    searchTime: string;
    sources: string[];
}

// --- 工具元数据 ---
export const literatureSearchTool = {
    name: 'literature_search',
    description: '全面查询最新学术文献，支持PubMed、arXiv、Semantic Scholar等数据库，自动提取论文标题、作者、摘要、发表时间、期刊、DOI、引用数等元数据',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: '搜索关键词或查询语句，支持布尔逻辑如 "cancer AND immunotherapy"'
            },
            maxResults: {
                type: 'number',
                description: '最大返回结果数量，默认20',
                default: 20
            },
            dateFrom: {
                type: 'string',
                description: '开始日期，格式YYYY-MM-DD，用于限定文献发表时间范围'
            },
            dateTo: {
                type: 'string',
                description: '结束日期，格式YYYY-MM-DD'
            },
            source: {
                type: 'string',
                enum: ['all', 'pubmed', 'arxiv', 'semantic', 'crossref'],
                description: '数据源：all(全部), pubmed, arxiv, semantic, crossref',
                default: 'all'
            },
            sortBy: {
                type: 'string',
                enum: ['relevance', 'date'],
                description: '排序方式：relevance(相关性), date(最新发表)',
                default: 'date'
            }
        },
        required: ['query']
    }
};

// --- HTTP请求工具函数 ---
function httpGet(url: string, timeout: number = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const request = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // 处理重定向
                httpGet(res.headers.location, timeout).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        request.setTimeout(timeout, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
        request.on('error', reject);
    });
}

// --- 数据源搜索实现 ---

/**
 * PubMed 搜索
 */
async function searchPubMed(query: string, maxResults: number): Promise<LiteratureResult[]> {
    try {
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodedQuery}&retmax=${maxResults}&retmode=json&sort=date`;
        const searchData = await httpGet(searchUrl);
        const searchJson = JSON.parse(searchData);
        
        if (!searchJson.esearchresult?.idlist?.length) {
            return [];
        }
        
        const ids = searchJson.esearchresult.idlist.slice(0, maxResults).join(',');
        const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids}&retmode=json`;
        const fetchData = await httpGet(fetchUrl);
        const fetchJson = JSON.parse(fetchData);
        
        const results: LiteratureResult[] = [];
        for (const id of searchJson.esearchresult.idlist.slice(0, maxResults)) {
            const article = fetchJson.result?.[id];
            if (!article) continue;
            
            results.push({
                id: `pubmed:${id}`,
                title: article.title || 'Untitled',
                authors: article.authors?.map((a: any) => a.name) || [],
                abstract: article.elocationid || '',
                publicationDate: article.pubdate || '',
                journal: article.source || '',
                doi: article.elocationid?.replace('doi: ', '') || '',
                url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
                citations: 0,
                source: 'PubMed',
                keywords: []
            });
        }
        return results;
    } catch (error) {
        logger.warn(`PubMed search failed: ${error}`);
        return [];
    }
}

/**
 * arXiv 搜索
 */
async function searchArxiv(query: string, maxResults: number): Promise<LiteratureResult[]> {
    try {
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `http://export.arxiv.org/api/query?search_query=all:${encodedQuery}&start=0&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;
        const xmlData = await httpGet(searchUrl, 20000);
        
        const results: LiteratureResult[] = [];
        const entries = xmlData.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
        
        for (const entry of entries.slice(0, maxResults)) {
            const getTag = (tag: string) => {
                const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
                return match ? match[1].trim() : '';
            };
            
            const authors = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g)?.map(a => 
                a.match(/<name>([\s\S]*?)<\/name>/)?.[1] || ''
            ) || [];
            
            const idMatch = getTag('id').match(/(\d+\.\d+)$/);
            
            results.push({
                id: `arxiv:${idMatch?.[1] || getTag('id')}`,
                title: getTag('title').replace(/\s+/g, ' '),
                authors,
                abstract: getTag('summary').replace(/\s+/g, ' '),
                publicationDate: getTag('published').split('T')[0],
                journal: 'arXiv',
                doi: '',
                url: getTag('id'),
                citations: 0,
                source: 'arXiv',
                keywords: getTag('category') ? [getTag('category')] : []
            });
        }
        return results;
    } catch (error) {
        logger.warn(`arXiv search failed: ${error}`);
        return [];
    }
}

/**
 * Semantic Scholar 搜索
 */
async function searchSemanticScholar(query: string, maxResults: number): Promise<LiteratureResult[]> {
    try {
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodedQuery}&limit=${maxResults}&fields=title,authors,abstract,year,venue,citationCount,externalIds,url`;
        const data = await httpGet(searchUrl);
        const json = JSON.parse(data);
        
        const results: LiteratureResult[] = [];
        for (const paper of (json.data || []).slice(0, maxResults)) {
            results.push({
                id: `semantic:${paper.paperId || paper.externalIds?.DOI || ''}`,
                title: paper.title || 'Untitled',
                authors: paper.authors?.map((a: any) => a.name) || [],
                abstract: paper.abstract || '',
                publicationDate: paper.year ? `${paper.year}` : '',
                journal: paper.venue || '',
                doi: paper.externalIds?.DOI || '',
                url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
                citations: paper.citationCount || 0,
                source: 'Semantic Scholar',
                keywords: []
            });
        }
        return results;
    } catch (error) {
        logger.warn(`Semantic Scholar search failed: ${error}`);
        return [];
    }
}

/**
 * CrossRef 搜索
 */
async function searchCrossRef(query: string, maxResults: number): Promise<LiteratureResult[]> {
    try {
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://api.crossref.org/works?query=${encodedQuery}&rows=${maxResults}&sort=published`;
        const data = await httpGet(searchUrl);
        const json = JSON.parse(data);
        
        const results: LiteratureResult[] = [];
        for (const item of (json.message?.items || []).slice(0, maxResults)) {
            const date = item['published-print'] || item['published-online'] || item.created;
            const dateStr = date?.['date-parts']?.[0] ? date['date-parts'][0].join('-') : '';
            
            results.push({
                id: `crossref:${item.DOI || item.URL || ''}`,
                title: item.title?.[0] || 'Untitled',
                authors: item.author?.map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()) || [],
                abstract: item.abstract || '',
                publicationDate: dateStr,
                journal: item['container-title']?.[0] || '',
                doi: item.DOI ? `https://doi.org/${item.DOI}` : '',
                url: item.URL || '',
                citations: item['is-referenced-by-count'] || 0,
                source: 'CrossRef',
                keywords: item.subject || []
            });
        }
        return results;
    } catch (error) {
        logger.warn(`CrossRef search failed: ${error}`);
        return [];
    }
}

// --- 主搜索函数 ---
export async function literatureSearch(params: LiteratureSearchParams): Promise<LiteratureSearchResult> {
    const startTime = Date.now();
    const {
        query,
        maxResults = 20,
        source = 'all'
    } = params;
    
    logger.info(`Literature search started: "${query}", source: ${source}`);
    
    const results: LiteratureResult[] = [];
    const sources: string[] = [];
    
    try {
        // 根据数据源执行搜索
        if (source === 'all' || source === 'pubmed') {
            const pubmedResults = await searchPubMed(query, Math.ceil(maxResults / 2));
            results.push(...pubmedResults);
            if (pubmedResults.length > 0) sources.push('PubMed');
        }
        
        if (source === 'all' || source === 'arxiv') {
            const arxivResults = await searchArxiv(query, Math.ceil(maxResults / 3));
            results.push(...arxivResults);
            if (arxivResults.length > 0) sources.push('arXiv');
        }
        
        if (source === 'all' || source === 'semantic') {
            const semanticResults = await searchSemanticScholar(query, Math.ceil(maxResults / 2));
            results.push(...semanticResults);
            if (semanticResults.length > 0) sources.push('Semantic Scholar');
        }
        
        if (source === 'all' || source === 'crossref') {
            const crossrefResults = await searchCrossRef(query, Math.ceil(maxResults / 3));
            results.push(...crossrefResults);
            if (crossrefResults.length > 0) sources.push('CrossRef');
        }
        
        // 去重（基于DOI或标题）
        const uniqueResults = results.reduce((acc, item) => {
            const key = item.doi || item.title;
            if (key && !acc.has(key)) {
                acc.set(key, item);
            }
            return acc;
        }, new Map<string, LiteratureResult>());
        
        // 按发表日期排序（最新的在前）
        const sortedResults = Array.from(uniqueResults.values())
            .filter(r => r.publicationDate)
            .sort((a, b) => {
                const dateA = new Date(a.publicationDate).getTime();
                const dateB = new Date(b.publicationDate).getTime();
                return isNaN(dateA) || isNaN(dateB) ? 0 : dateB - dateA;
            });
        
        // 合并无日期的结果
        const datedResults = sortedResults;
        const undatedResults = Array.from(uniqueResults.values()).filter(r => !r.publicationDate);
        
        const finalResults = [...datedResults, ...undatedResults].slice(0, maxResults);
        
        const searchTime = ((Date.now() - startTime) / 1000).toFixed(2);
        
        logger.info(`Literature search completed: ${finalResults.length} results in ${searchTime}s`);
        
        return {
            success: true,
            totalFound: finalResults.length,
            results: finalResults,
            query,
            searchTime: `${searchTime}s`,
            sources
        };
    } catch (error) {
        logger.error(`Literature search failed: ${error}`);
        return {
            success: false,
            totalFound: 0,
            results: [],
            query,
            searchTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
            sources,
            error: error instanceof Error ? error.message : 'Unknown error'
        } as any;
    }
}

// 兼容旧接口
export async function searchLiterature(query: string, maxResults: number = 20): Promise<LiteratureSearchResult> {
    return literatureSearch({ query, maxResults });
}

// --- 插件导出格式 (符合 Plugins.ts 规范) ---
export function main(params?: any) {
    return async (args: LiteratureSearchParams) => {
        return literatureSearch({ ...params, ...args });
    };
}

export function getPrompt() {
    return literatureSearchTool;
}
