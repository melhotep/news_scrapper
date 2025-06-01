/**
 * Utility functions for the adaptive news scraper
 */

const cheerio = require('cheerio');

/**
 * Normalize a URL to ensure it's absolute
 * @param {string} url - URL to normalize
 * @param {string} baseUrl - Base URL to use for relative URLs
 * @returns {string} - Normalized absolute URL
 */
const normalizeUrl = (url, baseUrl) => {
    if (!url) return null;
    
    try {
        // Handle relative URLs
        return new URL(url, baseUrl).href;
    } catch (error) {
        console.log(`Error normalizing URL: ${url}`, error);
        return null;
    }
};

/**
 * Extract text content from an element, cleaning up whitespace
 * @param {Element} element - DOM element to extract text from
 * @returns {string} - Cleaned text content
 */
const extractText = (element) => {
    if (!element) return null;
    
    const text = element.textContent || '';
    return text.trim()
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .replace(/[\r\n]+/g, ' '); // Remove newlines
};

/**
 * Calculate confidence score for an extraction method
 * @param {string} value - Extracted value
 * @param {number} baseConfidence - Base confidence score for the method
 * @param {Object} options - Additional options for confidence calculation
 * @returns {number} - Confidence score between 0 and 1
 */
const calculateConfidence = (value, baseConfidence, options = {}) => {
    if (!value) return 0;
    
    let score = baseConfidence;
    
    // Adjust score based on value length
    if (options.minLength && value.length < options.minLength) {
        score *= 0.8;
    }
    
    // Adjust score based on value format
    if (options.format && !options.format.test(value)) {
        score *= 0.7;
    }
    
    // Adjust score based on source reliability
    if (options.sourceReliability) {
        score *= options.sourceReliability;
    }
    
    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
};

/**
 * Check if an element is visible (not hidden by CSS)
 * @param {Element} element - DOM element to check
 * @returns {boolean} - Whether the element is visible
 */
const isVisible = (element) => {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0';
};

/**
 * Get common news-related class/ID patterns
 * @returns {Object} - Object with regex patterns for different content types
 */
const getNewsPatterns = () => {
    return {
        article: /\b(article|post|entry|story|news-item|content-item)\b/i,
        title: /\b(title|headline|heading|header|h-title)\b/i,
        date: /\b(date|time|published|posted|timestamp|datetime|pub-date|post-date)\b/i,
        summary: /\b(summary|excerpt|description|desc|teaser|intro|blurb|snippet|standfirst)\b/i
    };
};

/**
 * Extract metadata from HTML head
 * @param {string} html - HTML content
 * @returns {Object} - Extracted metadata
 */
const extractMetadata = (html) => {
    const $ = cheerio.load(html);
    const metadata = {};
    
    // Extract Open Graph metadata
    $('meta[property^="og:"]').each((i, el) => {
        const property = $(el).attr('property').replace('og:', '');
        const content = $(el).attr('content');
        if (content) {
            metadata[property] = content;
        }
    });
    
    // Extract Twitter card metadata
    $('meta[name^="twitter:"]').each((i, el) => {
        const name = $(el).attr('name').replace('twitter:', '');
        const content = $(el).attr('content');
        if (content) {
            metadata[`twitter_${name}`] = content;
        }
    });
    
    // Extract standard metadata
    $('meta[name="description"]').each((i, el) => {
        metadata.description = $(el).attr('content');
    });
    
    // Extract JSON-LD structured data
    $('script[type="application/ld+json"]').each((i, el) => {
        try {
            const jsonLd = JSON.parse($(el).html());
            metadata.jsonLd = metadata.jsonLd || [];
            metadata.jsonLd.push(jsonLd);
        } catch (error) {
            console.log('Error parsing JSON-LD:', error);
        }
    });
    
    return metadata;
};

module.exports = {
    normalizeUrl,
    extractText,
    calculateConfidence,
    isVisible,
    getNewsPatterns,
    extractMetadata
};
