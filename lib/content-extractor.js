/**
 * Content extractor module for the adaptive news scraper
 * 
 * This module contains methods for extracting title, link, date, and summary
 * from detected article elements using various strategies with fallbacks.
 */

const cheerio = require('cheerio');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const { 
    normalizeUrl, 
    extractText, 
    calculateConfidence, 
    getNewsPatterns,
    extractMetadata 
} = require('./utils');

/**
 * Extract title from an article element
 * @param {Object} $ - Cheerio instance
 * @param {Element} element - Article element
 * @param {Object} metadata - Page metadata
 * @param {string} baseUrl - Base URL for normalizing links
 * @returns {Object} - Extracted title with confidence score
 */
const extractTitle = ($, element, metadata, baseUrl) => {
    const $element = $(element);
    const patterns = getNewsPatterns();
    let title = null;
    let confidence = 0;
    let method = '';
    
    // Method 1: Look for heading elements within the article
    const headings = $element.find('h1, h2, h3').toArray();
    for (const heading of headings) {
        const $heading = $(heading);
        const text = $heading.text().trim();
        
        if (text && text.length > 5) {
            title = text;
            confidence = calculateConfidence(text, 0.9, { minLength: 10 });
            method = 'heading';
            break;
        }
    }
    
    // Method 2: Check for elements with title-related classes/IDs
    if (!title || confidence < 0.8) {
        $element.find('*').each((i, el) => {
            const $el = $(el);
            const classes = $el.attr('class') || '';
            const id = $el.attr('id') || '';
            
            if (patterns.title.test(classes) || patterns.title.test(id)) {
                const text = $el.text().trim();
                
                if (text && text.length > 5) {
                    const newConfidence = calculateConfidence(text, 0.85, { minLength: 10 });
                    
                    if (!title || newConfidence > confidence) {
                        title = text;
                        confidence = newConfidence;
                        method = 'classPattern';
                    }
                }
            }
        });
    }
    
    // Method 3: Look for anchor tags with substantial text
    if (!title || confidence < 0.7) {
        $element.find('a').each((i, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            
            if (text && text.length > 10 && text.length < 200) {
                const newConfidence = calculateConfidence(text, 0.75, { minLength: 15 });
                
                if (!title || newConfidence > confidence) {
                    title = text;
                    confidence = newConfidence;
                    method = 'anchor';
                }
            }
        });
    }
    
    // Method 4: Use metadata as fallback
    if (!title || confidence < 0.6) {
        if (metadata && metadata.title) {
            title = metadata.title;
            confidence = 0.6;
            method = 'metadata';
        } else if (metadata && metadata.og_title) {
            title = metadata.og_title;
            confidence = 0.65;
            method = 'ogMetadata';
        }
    }
    
    // Method 5: Last resort - use the first substantial text
    if (!title) {
        const text = $element.text().trim().split('\n')[0];
        if (text && text.length > 10 && text.length < 200) {
            title = text;
            confidence = 0.4;
            method = 'firstText';
        }
    }
    
    return {
        value: title,
        confidence,
        method
    };
};

/**
 * Extract link from an article element
 * @param {Object} $ - Cheerio instance
 * @param {Element} element - Article element
 * @param {Object} metadata - Page metadata
 * @param {string} baseUrl - Base URL for normalizing links
 * @returns {Object} - Extracted link with confidence score
 */
const extractLink = ($, element, metadata, baseUrl) => {
    const $element = $(element);
    let link = null;
    let confidence = 0;
    let method = '';
    
    // Method 1: Look for anchor tags wrapping or near the title
    const headings = $element.find('h1, h2, h3').toArray();
    for (const heading of headings) {
        const $heading = $(heading);
        
        // Check if heading is wrapped by an anchor
        if ($heading.parent().is('a')) {
            const href = $heading.parent().attr('href');
            if (href) {
                link = normalizeUrl(href, baseUrl);
                confidence = 0.95;
                method = 'headingParentAnchor';
                break;
            }
        }
        
        // Check for anchors inside the heading
        const $anchor = $heading.find('a');
        if ($anchor.length > 0) {
            const href = $anchor.attr('href');
            if (href) {
                link = normalizeUrl(href, baseUrl);
                confidence = 0.9;
                method = 'headingChildAnchor';
                break;
            }
        }
    }
    
    // Method 2: Look for the first substantial anchor in the article
    if (!link) {
        $element.find('a').each((i, el) => {
            const $el = $(el);
            const href = $el.attr('href');
            const text = $el.text().trim();
            
            if (href && text && text.length > 10) {
                link = normalizeUrl(href, baseUrl);
                confidence = 0.8;
                method = 'substantialAnchor';
                return false; // Break the loop
            }
        });
    }
    
    // Method 3: Check for canonical link in metadata
    if (!link && metadata) {
        if (metadata.canonical) {
            link = normalizeUrl(metadata.canonical, baseUrl);
            confidence = 0.7;
            method = 'canonical';
        } else if (metadata.og_url) {
            link = normalizeUrl(metadata.og_url, baseUrl);
            confidence = 0.75;
            method = 'ogUrl';
        }
    }
    
    // Method 4: Fallback to the current page URL for single-article pages
    if (!link) {
        link = baseUrl;
        confidence = 0.5;
        method = 'currentPage';
    }
    
    return {
        value: link,
        confidence,
        method
    };
};

/**
 * Extract date from an article element
 * @param {Object} $ - Cheerio instance
 * @param {Element} element - Article element
 * @param {Object} metadata - Page metadata
 * @param {string} baseUrl - Base URL for normalizing links
 * @returns {Object} - Extracted date with confidence score
 */
const extractDate = ($, element, metadata, baseUrl) => {
    const $element = $(element);
    const patterns = getNewsPatterns();
    let date = null;
    let confidence = 0;
    let method = '';
    
    // Method 1: Look for time elements or elements with datetime attributes
    $element.find('time, [datetime]').each((i, el) => {
        const $el = $(el);
        const datetime = $el.attr('datetime');
        
        if (datetime) {
            try {
                // Validate the datetime format
                const parsedDate = new Date(datetime);
                if (!isNaN(parsedDate.getTime())) {
                    date = datetime;
                    confidence = 0.95;
                    method = 'datetimeAttribute';
                    return false; // Break the loop
                }
            } catch (error) {
                // Invalid date format, continue searching
            }
        }
        
        // If no datetime attribute, try the text content
        const text = $el.text().trim();
        if (text && isLikelyDate(text)) {
            date = text;
            confidence = 0.85;
            method = 'timeElement';
            return false; // Break the loop
        }
    });
    
    // Method 2: Search for elements with date-related classes/IDs
    if (!date) {
        $element.find('*').each((i, el) => {
            const $el = $(el);
            const classes = $el.attr('class') || '';
            const id = $el.attr('id') || '';
            
            if (patterns.date.test(classes) || patterns.date.test(id)) {
                const text = $el.text().trim();
                
                if (text && isLikelyDate(text)) {
                    date = text;
                    confidence = 0.8;
                    method = 'dateClassPattern';
                    return false; // Break the loop
                }
            }
        });
    }
    
    // Method 3: Use regular expressions to identify date patterns in text
    if (!date) {
        const allText = $element.text();
        const dateMatch = findDateInText(allText);
        
        if (dateMatch) {
            date = dateMatch;
            confidence = 0.7;
            method = 'regexPattern';
        }
    }
    
    // Method 4: Extract from metadata
    if (!date && metadata) {
        if (metadata.published_time) {
            date = metadata.published_time;
            confidence = 0.85;
            method = 'metadataPublishedTime';
        } else if (metadata.modified_time) {
            date = metadata.modified_time;
            confidence = 0.8;
            method = 'metadataModifiedTime';
        } else if (metadata.article_published_time) {
            date = metadata.article_published_time;
            confidence = 0.85;
            method = 'articlePublishedTime';
        }
    }
    
    return {
        value: date,
        confidence,
        method
    };
};

/**
 * Extract summary from an article element
 * @param {Object} $ - Cheerio instance
 * @param {Element} element - Article element
 * @param {Object} metadata - Page metadata
 * @param {string} baseUrl - Base URL for normalizing links
 * @returns {Object} - Extracted summary with confidence score
 */
const extractSummary = ($, element, metadata, baseUrl) => {
    const $element = $(element);
    const patterns = getNewsPatterns();
    let summary = null;
    let confidence = 0;
    let method = '';
    
    // Method 1: Look for elements with summary-related classes/IDs
    $element.find('*').each((i, el) => {
        const $el = $(el);
        const classes = $el.attr('class') || '';
        const id = $el.attr('id') || '';
        
        if (patterns.summary.test(classes) || patterns.summary.test(id)) {
            const text = $el.text().trim();
            
            if (text && text.length > 20) {
                summary = text;
                confidence = 0.9;
                method = 'summaryClassPattern';
                return false; // Break the loop
            }
        }
    });
    
    // Method 2: Check for meta description
    if (!summary && metadata && metadata.description) {
        summary = metadata.description;
        confidence = 0.8;
        method = 'metaDescription';
    }
    
    // Method 3: Use Open Graph description
    if (!summary && metadata && metadata.og_description) {
        summary = metadata.og_description;
        confidence = 0.85;
        method = 'ogDescription';
    }
    
    // Method 4: Fall back to the first paragraph
    if (!summary) {
        $element.find('p').each((i, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            
            if (text && text.length > 30 && !isLikelyDate(text)) {
                summary = text;
                confidence = 0.7;
                method = 'firstParagraph';
                return false; // Break the loop
            }
        });
    }
    
    // Method 5: Last resort - use the first substantial text
    if (!summary) {
        const text = $element.text().trim();
        if (text && text.length > 50) {
            // Extract first 150 characters as summary
            summary = text.substring(0, 150).trim();
            if (summary.length === 150 && !summary.endsWith('.')) {
                summary += '...';
            }
            confidence = 0.5;
            method = 'textExtract';
        }
    }
    
    return {
        value: summary,
        confidence,
        method
    };
};

/**
 * Check if a string is likely to be a date
 * @param {string} text - Text to check
 * @returns {boolean} - Whether the text is likely a date
 */
const isLikelyDate = (text) => {
    // Simple patterns to identify dates
    const datePatterns = [
        /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/,  // DD/MM/YYYY, MM/DD/YYYY
        /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/,    // YYYY/MM/DD
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b/i,  // DD Month YYYY
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/i,  // Month DD, YYYY
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b/i,  // Month DD
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i,  // DD Month
        /\b(?:yesterday|today|tomorrow)\b/i,  // Relative dates
        /\b\d+\s+(?:hour|day|week|month|year)s?\s+ago\b/i  // X time ago
    ];
    
    return datePatterns.some(pattern => pattern.test(text));
};

/**
 * Find a date pattern in text
 * @param {string} text - Text to search
 * @returns {string|null} - Extracted date string or null
 */
const findDateInText = (text) => {
    // Common date formats to search for
    const dateRegexes = [
        /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/,
        /\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/,
        /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b/i,
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/i,
        /\b(?:yesterday|today|tomorrow)\b/i,
        /\b\d+\s+(?:hour|day|week|month|year)s?\s+ago\b/i
    ];
    
    for (const regex of dateRegexes) {
        const match = text.match(regex);
        if (match) {
            return match[0];
        }
    }
    
    return null;
};

/**
 * Extract all required data from an article element
 * @param {string} html - HTML content
 * @param {Element} element - Article element
 * @param {string} baseUrl - Base URL for normalizing links
 * @returns {Object} - Extracted article data with confidence scores
 */
const extractArticleData = (html, element, baseUrl) => {
    const $ = cheerio.load(html);
    const metadata = extractMetadata(html);
    
    const titleData = extractTitle($, element, metadata, baseUrl);
    const linkData = extractLink($, element, metadata, baseUrl);
    const dateData = extractDate($, element, metadata, baseUrl);
    const summaryData = extractSummary($, element, metadata, baseUrl);
    
    return {
        title: titleData.value,
        link: linkData.value,
        date: dateData.value,
        summary: summaryData.value,
        confidence: {
            title: titleData.confidence,
            link: linkData.confidence,
            date: dateData.confidence,
            summary: summaryData.confidence,
            overall: (
                titleData.confidence + 
                linkData.confidence + 
                dateData.confidence + 
                summaryData.confidence
            ) / 4
        },
        methods: {
            title: titleData.method,
            link: linkData.method,
            date: dateData.method,
            summary: summaryData.method
        }
    };
};

/**
 * Use Readability as a fallback for single-article pages
 * @param {string} html - HTML content
 * @param {string} url - Page URL
 * @returns {Object|null} - Extracted article data or null if extraction fails
 */
const extractWithReadability = (html, url) => {
    try {
        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        
        if (!article) return null;
        
        return {
            title: article.title,
            link: url,
            date: null, // Readability doesn't extract dates
            summary: article.excerpt,
            confidence: {
                title: 0.7,
                link: 1.0,
                date: 0,
                summary: 0.6,
                overall: 0.575
            },
            methods: {
                title: 'readability',
                link: 'currentUrl',
                date: 'none',
                summary: 'readability'
            }
        };
    } catch (error) {
        console.log('Error using Readability:', error);
        return null;
    }
};

module.exports = {
    extractArticleData,
    extractWithReadability,
    extractTitle,
    extractLink,
    extractDate,
    extractSummary
};
