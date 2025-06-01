/**
 * Article detector module for the adaptive news scraper
 * 
 * This module contains algorithms for detecting news article elements
 * on various types of news websites.
 */

const cheerio = require('cheerio');
const { getNewsPatterns, isVisible } = require('./utils');

/**
 * Detect article elements using semantic HTML
 * @param {string} html - HTML content of the page
 * @returns {Array} - Array of potential article elements with confidence scores
 */
const detectBySemanticHTML = (html) => {
    const $ = cheerio.load(html);
    const results = [];
    
    // Look for semantic HTML5 elements
    $('article').each((i, el) => {
        results.push({
            element: el,
            method: 'semanticHTML',
            confidence: 0.9,
            selector: 'article'
        });
    });
    
    // Check for main content area with articles inside
    $('main article, [role="main"] article').each((i, el) => {
        results.push({
            element: el,
            method: 'semanticHTML',
            confidence: 0.95,
            selector: 'main article'
        });
    });
    
    // Look for sections that might contain articles
    $('section').each((i, el) => {
        // Only consider sections with substantial content
        if ($(el).text().length > 100) {
            results.push({
                element: el,
                method: 'semanticHTML',
                confidence: 0.7,
                selector: 'section'
            });
        }
    });
    
    return results;
};

/**
 * Detect article elements using common class/ID patterns
 * @param {string} html - HTML content of the page
 * @returns {Array} - Array of potential article elements with confidence scores
 */
const detectByClassPatterns = (html) => {
    const $ = cheerio.load(html);
    const results = [];
    const patterns = getNewsPatterns();
    
    // Look for elements with article-related classes or IDs
    $('*').each((i, el) => {
        const classes = $(el).attr('class') || '';
        const id = $(el).attr('id') || '';
        
        if (patterns.article.test(classes) || patterns.article.test(id)) {
            // Calculate confidence based on how specific the match is
            let confidence = 0.8;
            
            // Boost confidence for more specific matches
            if (/\barticle\b/i.test(classes) || /\barticle\b/i.test(id)) {
                confidence = 0.85;
            }
            if (/\bnews-item\b/i.test(classes) || /\bnews-item\b/i.test(id)) {
                confidence = 0.85;
            }
            
            // Reduce confidence for very generic elements
            if ($(el).is('div') && $(el).children().length < 2) {
                confidence *= 0.7;
            }
            
            results.push({
                element: el,
                method: 'classPatterns',
                confidence,
                selector: `[class*="${classes}"]` || `[id="${id}"]`
            });
        }
    });
    
    return results;
};

/**
 * Detect article elements by analyzing DOM structure
 * @param {string} html - HTML content of the page
 * @returns {Array} - Array of potential article elements with confidence scores
 */
const detectByDOMStructure = (html) => {
    const $ = cheerio.load(html);
    const results = [];
    
    // Find parent elements with multiple similar children
    $('div, section, main').each((i, parent) => {
        const children = $(parent).children().toArray();
        
        // Skip if too few children
        if (children.length < 3) return;
        
        // Group similar elements by tag structure
        const structureGroups = {};
        
        children.forEach((child) => {
            // Create a simple signature of the element structure
            const signature = getElementSignature($, child);
            
            if (!structureGroups[signature]) {
                structureGroups[signature] = [];
            }
            structureGroups[signature].push(child);
        });
        
        // Find groups with multiple similar elements
        Object.entries(structureGroups).forEach(([signature, group]) => {
            if (group.length >= 3 && signature.includes('heading')) {
                // These are likely to be article listings
                group.forEach((element) => {
                    results.push({
                        element,
                        method: 'domStructure',
                        confidence: 0.75,
                        selector: getElementPath($, element)
                    });
                });
            }
        });
    });
    
    return results;
};

/**
 * Detect article elements using content-based heuristics
 * @param {string} html - HTML content of the page
 * @returns {Array} - Array of potential article elements with confidence scores
 */
const detectByContentHeuristics = (html) => {
    const $ = cheerio.load(html);
    const results = [];
    
    // Look for elements with substantial text and possibly images
    $('div, section, li').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        const hasImage = $el.find('img').length > 0;
        const hasHeading = $el.find('h1, h2, h3, h4, h5, h6').length > 0;
        const hasLink = $el.find('a').length > 0;
        
        // Skip elements with too little text
        if (text.length < 50) return;
        
        let confidence = 0.6; // Base confidence
        
        // Adjust confidence based on content characteristics
        if (hasHeading) confidence += 0.1;
        if (hasImage) confidence += 0.1;
        if (hasLink) confidence += 0.05;
        if (text.length > 200) confidence += 0.05;
        
        // Check if this element contains other detected elements
        if ($el.find('article').length > 0) confidence -= 0.2;
        
        results.push({
            element: el,
            method: 'contentHeuristics',
            confidence,
            selector: getElementPath($, el)
        });
    });
    
    return results;
};

/**
 * Get a simple signature representing the structure of an element
 * @param {Object} $ - Cheerio instance
 * @param {Element} element - DOM element
 * @returns {string} - Signature string
 */
const getElementSignature = ($, element) => {
    const $el = $(element);
    const hasHeading = $el.find('h1, h2, h3, h4, h5, h6').length > 0;
    const hasImage = $el.find('img').length > 0;
    const hasLink = $el.find('a').length > 0;
    const hasText = $el.text().trim().length > 0;
    
    return [
        hasHeading ? 'heading' : '',
        hasImage ? 'image' : '',
        hasLink ? 'link' : '',
        hasText ? 'text' : ''
    ].filter(Boolean).join('-');
};

/**
 * Get a CSS selector path for an element
 * @param {Object} $ - Cheerio instance
 * @param {Element} element - DOM element
 * @returns {string} - CSS selector path
 */
const getElementPath = ($, element) => {
    const $el = $(element);
    const tag = element.tagName.toLowerCase();
    const id = $el.attr('id') ? `#${$el.attr('id')}` : '';
    
    if (id) return `${tag}${id}`;
    
    const classes = $el.attr('class') ? 
        `.${$el.attr('class').trim().replace(/\s+/g, '.')}` : '';
    
    return classes ? `${tag}${classes}` : tag;
};

/**
 * Combine and deduplicate article detection results
 * @param {Array} results - Array of detection results from different methods
 * @returns {Array} - Deduplicated and sorted array of article elements
 */
const combineResults = (results) => {
    // Group by element to handle duplicates
    const elementMap = new Map();
    
    results.forEach((result) => {
        const elementKey = result.selector;
        
        if (!elementMap.has(elementKey) || 
            elementMap.get(elementKey).confidence < result.confidence) {
            elementMap.set(elementKey, result);
        }
    });
    
    // Convert back to array and sort by confidence
    return Array.from(elementMap.values())
        .sort((a, b) => b.confidence - a.confidence);
};

/**
 * Detect article elements using all available methods
 * @param {string} html - HTML content of the page
 * @returns {Array} - Array of detected article elements with confidence scores
 */
const detectArticles = (html) => {
    // Apply all detection methods
    const semanticResults = detectBySemanticHTML(html);
    const classResults = detectByClassPatterns(html);
    const domResults = detectByDOMStructure(html);
    const contentResults = detectByContentHeuristics(html);
    
    // Combine and deduplicate results
    const allResults = [
        ...semanticResults,
        ...classResults,
        ...domResults,
        ...contentResults
    ];
    
    return combineResults(allResults);
};

module.exports = {
    detectArticles,
    detectBySemanticHTML,
    detectByClassPatterns,
    detectByDOMStructure,
    detectByContentHeuristics
};
