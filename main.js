/**
 * Adaptive News Scraper Actor
 * 
 * This actor scrapes news items from various dynamic news sites,
 * automatically detecting and extracting title, link, date, and summary.
 */

const { Actor } = require('apify');
const { PlaywrightCrawler, Dataset } = require('crawlee');

// Initialize the Actor
Actor.main(async () => {
    // Get input from the user
    const input = await Actor.getInput();
    console.log('Input:', input);

    if (!input || !input.url) {
        throw new Error('Input must contain a "url" field!');
    }

    const { url, maxItems = 0, waitTime = 30 } = input;
    console.log(`Starting adaptive scraper for URL: ${url}`);
    console.log(`Maximum items to extract: ${maxItems || 'unlimited'}`);
    console.log(`Wait time for dynamic content: ${waitTime} seconds`);

    // Initialize the dataset to store results
    const dataset = await Dataset.open();
    let extractedCount = 0;
    let methodsUsed = new Set();

    // Create a PlaywrightCrawler instance
    const crawler = new PlaywrightCrawler({
        // Use headless browser for production
        launchContext: {
            launchOptions: {
                headless: true,
            },
        },

        // This function will be called for each URL
        async requestHandler({ page, request, enqueueLinks, log }) {
            log.info(`Processing ${request.url}...`);

            try {
                // Wait for the page to load completely with increased timeout
                await page.waitForLoadState('domcontentloaded', { timeout: waitTime * 1000 });
                
                // Additional wait time for dynamic content
                log.info(`Waiting ${waitTime} seconds for dynamic content to load...`);
                await page.waitForTimeout(waitTime * 1000);

                // Debug: Log the page title
                const pageTitle = await page.title();
                log.info(`Page title: ${pageTitle}`);

                // Inject helper functions for content analysis
                await page.evaluate(() => {
                    window.isMainContent = function(element) {
                        // Check if element is in a sidebar, header, footer, or navigation
                        const isInSidebar = 
                            element.closest('[class*="sidebar"], [id*="sidebar"], [class*="widget"], [class*="related"], [class*="latest"], [class*="most-read"]') !== null ||
                            element.closest('[class*="footer"], [id*="footer"], [class*="header"], [id*="header"]') !== null ||
                            element.closest('nav, [role="navigation"]') !== null;
                        
                        // If it's clearly in a sidebar, immediately reject
                        if (isInSidebar) return false;
                        
                        // Check if element is in a main content area
                        const isInMainContent = 
                            element.closest('main, [role="main"], [id*="content"], [class*="content"], [id*="main"], [class*="main"], article') !== null;
                        
                        // Check if element has significant content
                        const hasSignificantContent = 
                            element.textContent.length > 150 && 
                            element.querySelectorAll('h1, h2, h3, h4, p').length > 1;
                        
                        // Check if element is part of search results
                        const isSearchResult = 
                            element.closest('[class*="search-result"], [class*="search_result"]') !== null ||
                            (element.parentElement && element.parentElement.children.length > 1 && 
                             Array.from(element.parentElement.children).some(sibling => 
                                 sibling.textContent.includes('Results') || 
                                 sibling.textContent.includes('Search')
                             ));
                        
                        // Check if element is in the main column by analyzing layout
                        let isInMainColumn = false;
                        const viewportWidth = window.innerWidth;
                        const elementRect = element.getBoundingClientRect();
                        const elementCenterX = elementRect.left + (elementRect.width / 2);
                        
                        // Elements in the middle third of the page are more likely to be main content
                        if (elementCenterX > viewportWidth * 0.25 && elementCenterX < viewportWidth * 0.75) {
                            isInMainColumn = true;
                        }
                        
                        return (isInMainContent || isSearchResult || isInMainColumn) && hasSignificantContent && !isInSidebar;
                    };
                    
                    window.getArticleConfidence = function(element) {
                        let score = 0;
                        
                        // Score based on element type
                        if (element.tagName === 'ARTICLE') score += 0.3;
                        else if (element.classList.contains('article')) score += 0.25;
                        else if (element.classList.contains('post')) score += 0.25;
                        else if (element.classList.contains('news-item')) score += 0.25;
                        else if (element.classList.contains('story')) score += 0.25;
                        else if (element.classList.contains('search-result')) score += 0.3;
                        
                        // Score based on content
                        if (element.querySelector('h1, h2, h3, h4')) score += 0.2;
                        if (element.querySelector('a')) score += 0.1;
                        if (element.querySelector('p')) score += 0.1;
                        if (element.querySelector('time, [datetime], [class*="date"]')) score += 0.2;
                        
                        // Score based on position
                        const viewportWidth = window.innerWidth;
                        const elementRect = element.getBoundingClientRect();
                        const elementCenterX = elementRect.left + (elementRect.width / 2);
                        
                        // Elements in the middle of the page get higher score
                        if (elementCenterX > viewportWidth * 0.4 && elementCenterX < viewportWidth * 0.6) {
                            score += 0.2;
                        } else if (elementCenterX > viewportWidth * 0.3 && elementCenterX < viewportWidth * 0.7) {
                            score += 0.1;
                        }
                        
                        return Math.min(score, 0.95);
                    };
                });

                // ADAPTIVE APPROACH: Detect article elements using multiple strategies
                log.info('Detecting article elements using adaptive strategies...');
                
                // Strategy 1: Look for search results specifically
                const searchResults = await page.$$eval('.search-results article, .search-result, [class*="search-result"], [class*="search"] article, [class*="result"] article, [class*="search"] .item', 
                    (elements) => {
                        return elements.map((el, index) => {
                            if (window.isMainContent(el)) {
                                return {
                                    index,
                                    method: 'searchResults',
                                    confidence: window.getArticleConfidence(el)
                                };
                            }
                            return null;
                        }).filter(item => item !== null);
                    }
                );
                log.info(`Found ${searchResults.length} search result elements`);
                
                // Strategy 2: Look for semantic HTML elements
                const semanticArticles = await page.$$eval('article, .article, [class*="article"], [class*="post"], [class*="news-item"], [class*="story"]', 
                    (elements) => {
                        return elements.map((el, index) => {
                            if (window.isMainContent(el)) {
                                return {
                                    index,
                                    method: 'semanticHTML',
                                    confidence: window.getArticleConfidence(el)
                                };
                            }
                            return null;
                        }).filter(item => item !== null);
                    }
                );
                log.info(`Found ${semanticArticles.length} semantic HTML elements`);
                
                // Strategy 3: Look for content containers with specific patterns
                const contentContainers = await page.$$eval('div[class*="content"] > div, div[class*="search-result"], div[class*="listing"] > div, div[class*="feed"] > div', 
                    (elements) => {
                        return elements.map((el, index) => {
                            // Only consider elements with substantial content
                            if (el.textContent.length > 100 && el.querySelectorAll('a, h1, h2, h3, h4, p').length > 0 && window.isMainContent(el)) {
                                return {
                                    index,
                                    method: 'contentPattern',
                                    confidence: window.getArticleConfidence(el)
                                };
                            }
                            return null;
                        }).filter(item => item !== null);
                    }
                );
                log.info(`Found ${contentContainers.length} content containers`);
                
                // Strategy 4: Look for repeated structures (common in listings)
                const repeatedStructures = await page.$$eval('div > div, section > div, main > div', 
                    (elements) => {
                        // Group similar elements by structure
                        const groups = {};
                        
                        elements.forEach((el, index) => {
                            // Create a simple signature based on element structure
                            const hasHeading = el.querySelector('h1, h2, h3, h4, h5, h6') !== null;
                            const hasLink = el.querySelector('a') !== null;
                            const hasImage = el.querySelector('img') !== null;
                            const hasText = el.textContent.trim().length > 100;
                            
                            if (hasHeading && hasLink && hasText && window.isMainContent(el)) {
                                const signature = `${hasHeading}-${hasLink}-${hasImage}-${hasText}`;
                                
                                if (!groups[signature]) {
                                    groups[signature] = [];
                                }
                                
                                groups[signature].push({
                                    index,
                                    method: 'repeatedStructure',
                                    confidence: window.getArticleConfidence(el)
                                });
                            }
                        });
                        
                        // Only consider groups with multiple similar elements (likely listings)
                        let results = [];
                        Object.values(groups).forEach(group => {
                            if (group.length >= 2) {
                                results = results.concat(group);
                            }
                        });
                        
                        return results;
                    }
                );
                log.info(`Found ${repeatedStructures.length} repeated structures`);
                
                // Combine all detected articles and remove duplicates
                const allDetectedElements = [];
                
                // Process each detection strategy and add to allDetectedElements
                for (const strategy of ['searchResults', 'semanticHTML', 'contentPattern', 'repeatedStructure']) {
                    let elements;
                    
                    if (strategy === 'searchResults') {
                        elements = searchResults;
                    } else if (strategy === 'semanticHTML') {
                        elements = semanticArticles;
                    } else if (strategy === 'contentPattern') {
                        elements = contentContainers;
                    } else {
                        elements = repeatedStructures;
                    }
                    
                    // Add elements from this strategy
                    for (let i = 0; i < elements.length; i++) {
                        const element = elements[i];
                        
                        // Extract data using adaptive selectors
                        const articleData = await page.evaluate(({ index, strategy }) => {
                            let element;
                            
                            // Find the element based on strategy
                            if (strategy === 'searchResults') {
                                const elements = document.querySelectorAll('.search-results article, .search-result, [class*="search-result"], [class*="search"] article, [class*="result"] article, [class*="search"] .item');
                                let validElements = [];
                                for (const el of elements) {
                                    if (window.isMainContent(el)) {
                                        validElements.push(el);
                                    }
                                }
                                element = validElements[index];
                            } else if (strategy === 'semanticHTML') {
                                const elements = document.querySelectorAll('article, .article, [class*="article"], [class*="post"], [class*="news-item"], [class*="story"]');
                                let validElements = [];
                                for (const el of elements) {
                                    if (window.isMainContent(el)) {
                                        validElements.push(el);
                                    }
                                }
                                element = validElements[index];
                            } else if (strategy === 'contentPattern') {
                                const elements = document.querySelectorAll('div[class*="content"] > div, div[class*="search-result"], div[class*="listing"] > div, div[class*="feed"] > div');
                                let validElements = [];
                                for (const el of elements) {
                                    if (el.textContent.length > 100 && el.querySelectorAll('a, h1, h2, h3, h4, p').length > 0 && window.isMainContent(el)) {
                                        validElements.push(el);
                                    }
                                }
                                element = validElements[index];
                            } else {
                                // For repeatedStructure, we need to recalculate the groups
                                const elements = document.querySelectorAll('div > div, section > div, main > div');
                                let validElements = [];
                                for (const el of elements) {
                                    const hasHeading = el.querySelector('h1, h2, h3, h4, h5, h6') !== null;
                                    const hasLink = el.querySelector('a') !== null;
                                    const hasText = el.textContent.trim().length > 100;
                                    
                                    if (hasHeading && hasLink && hasText && window.isMainContent(el)) {
                                        validElements.push(el);
                                    }
                                }
                                element = validElements[index];
                            }
                            
                            if (!element) return null;
                            
                            // ADAPTIVE EXTRACTION: Try multiple selectors for each field
                            
                            // Title extraction
                            let title = null;
                            let titleElement = null;
                            
                            // Try multiple selectors for title
                            const titleSelectors = [
                                'h1, h2, h3, h4', // Headings
                                'a[class*="title"], a[class*="headline"], a[class*="heading"]', // Classed anchors
                                'a:has(h1), a:has(h2), a:has(h3), a:has(h4)', // Anchors with headings
                                'a', // Any anchor (last resort)
                                '[class*="title"], [class*="headline"], [class*="heading"]' // Elements with title-like classes
                            ];
                            
                            for (const selector of titleSelectors) {
                                titleElement = element.querySelector(selector);
                                if (titleElement) {
                                    title = titleElement.textContent.trim();
                                    if (title && title.length > 5) break;
                                }
                            }
                            
                            // Link extraction
                            let link = null;
                            
                            // If title element is or contains an anchor, use its href
                            if (titleElement) {
                                if (titleElement.tagName === 'A') {
                                    link = titleElement.href;
                                } else {
                                    const anchorInTitle = titleElement.querySelector('a');
                                    if (anchorInTitle) {
                                        link = anchorInTitle.href;
                                    }
                                }
                            }
                            
                            // If no link found yet, try other selectors
                            if (!link) {
                                const linkSelectors = [
                                    'a[class*="link"], a[class*="read-more"]',
                                    'a:has(img)',
                                    'a'
                                ];
                                
                                for (const selector of linkSelectors) {
                                    const linkElement = element.querySelector(selector);
                                    if (linkElement) {
                                        link = linkElement.href;
                                        if (link) break;
                                    }
                                }
                            }
                            
                            // Date extraction
                            let date = null;
                            
                            const dateSelectors = [
                                'time, [datetime]', // Semantic time elements
                                '[class*="date"], [class*="time"], [class*="published"]', // Date classes
                                'span:has([class*="date"]), div:has([class*="date"])' // Containers with date classes
                            ];
                            
                            for (const selector of dateSelectors) {
                                const dateElement = element.querySelector(selector);
                                if (dateElement) {
                                    // Try datetime attribute first
                                    if (dateElement.getAttribute('datetime')) {
                                        date = dateElement.getAttribute('datetime');
                                    } else {
                                        date = dateElement.textContent.trim();
                                    }
                                    if (date) break;
                                }
                            }
                            
                            // Summary extraction
                            let summary = null;
                            
                            const summarySelectors = [
                                '[class*="summary"], [class*="excerpt"], [class*="description"], [class*="teaser"]',
                                'p',
                                'div[class*="body"], div[class*="content"]'
                            ];
                            
                            for (const selector of summarySelectors) {
                                const summaryElement = element.querySelector(selector);
                                if (summaryElement) {
                                    summary = summaryElement.textContent.trim();
                                    if (summary && summary.length > 20) break;
                                }
                            }
                            
                            // Calculate confidence scores
                            const titleConfidence = title ? 0.9 : 0;
                            const linkConfidence = link ? 0.9 : 0;
                            const dateConfidence = date ? 0.8 : 0;
                            const summaryConfidence = summary ? 0.8 : 0;
                            const overallConfidence = (titleConfidence + linkConfidence + dateConfidence + summaryConfidence) / 4;
                            
                            return {
                                title,
                                link,
                                date,
                                summary,
                                confidence: {
                                    title: titleConfidence,
                                    link: linkConfidence,
                                    date: dateConfidence,
                                    summary: summaryConfidence,
                                    overall: overallConfidence
                                },
                                methods: {
                                    title: strategy,
                                    link: strategy,
                                    date: strategy,
                                    summary: strategy
                                }
                            };
                        }, { index: element.index, strategy });
                        
                        // Only add if we have at least a title and link
                        if (articleData && articleData.title && articleData.link) {
                            allDetectedElements.push(articleData);
                            methodsUsed.add(strategy);
                            log.info(`Successfully extracted article using ${strategy}: ${articleData.title}`);
                        }
                    }
                }
                
                // Sort by confidence and remove duplicates
                const uniqueArticles = [];
                const seenLinks = new Set();
                const seenTitles = new Set();
                
                // Sort by confidence (highest first)
                allDetectedElements.sort((a, b) => b.confidence.overall - a.confidence.overall);
                
                // Remove duplicates based on link or title
                for (const article of allDetectedElements) {
                    // Normalize link by removing trailing slashes and query parameters
                    const normalizedLink = article.link.replace(/\/$/, '').split('?')[0];
                    
                    // Normalize title by removing extra whitespace and converting to lowercase
                    const normalizedTitle = article.title.toLowerCase().replace(/\s+/g, ' ').trim();
                    
                    if (!seenLinks.has(normalizedLink) && !seenTitles.has(normalizedTitle)) {
                        uniqueArticles.push(article);
                        seenLinks.add(normalizedLink);
                        seenTitles.add(normalizedTitle);
                        
                        // Stop if we've reached the maximum
                        if (maxItems > 0 && uniqueArticles.length >= maxItems) {
                            break;
                        }
                    }
                }
                
                // Log the number of extracted items
                log.info(`Successfully extracted ${uniqueArticles.length} unique news items`);
                
                // Save the results to the dataset
                await dataset.pushData(uniqueArticles);
                extractedCount += uniqueArticles.length;

                // Check if we've reached the maximum number of items
                if (maxItems > 0 && extractedCount >= maxItems) {
                    log.info(`Reached maximum number of items (${maxItems}), stopping the crawler.`);
                    await crawler.stop();
                }
            } catch (error) {
                log.error(`Error processing ${request.url}: ${error.message}`);
                throw error;
            }
        },

        // This function is called if the page processing fails
        failedRequestHandler({ request, error, log }) {
            log.error(`Request ${request.url} failed:\n${error}`);
        },
    });

    // Start the crawler with the provided URL
    await crawler.run([url]);

    // Get the results from the dataset
    const results = await dataset.getData();
    
    // Calculate success metrics
    const totalItems = results.items.flatMap(item => item).length;
    const itemsWithAllFields = results.items.flatMap(item => item).filter(
        item => item.title && item.link && item.date && item.summary
    ).length;
    
    const successRate = totalItems > 0 ? itemsWithAllFields / totalItems : 0;
    
    // Prepare the output
    const output = {
        newsItems: results.items.flatMap(item => item),
        totalCount: totalItems,
        url: url,
        extractionStats: {
            methodsUsed: Array.from(methodsUsed),
            successRate: successRate,
            completeItems: itemsWithAllFields,
            partialItems: totalItems - itemsWithAllFields
        }
    };

    // Store the output
    await Actor.pushData(output);
    console.log('Scraping finished successfully!');
});
