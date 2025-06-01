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

                // Take a screenshot for debugging
                await page.screenshot({ path: 'debug-screenshot.png' });
                log.info('Saved debug screenshot to debug-screenshot.png');

                // Save HTML for debugging
                const html = await page.content();
                await Actor.setValue('debug-html', html);
                log.info('Saved HTML to Key-Value store as debug-html');

                // Debug: Log the page title
                const pageTitle = await page.title();
                log.info(`Page title: ${pageTitle}`);

                // DIRECT APPROACH: Extract search results using a combination of strategies
                log.info('Extracting search results using direct approach...');
                
                // Try to find search results directly
                const searchResults = await page.evaluate(() => {
                    // Helper function to check if text contains search-related terms
                    const isSearchRelated = (text) => {
                        const searchTerms = ['search', 'result', 'found', 'query'];
                        return searchTerms.some(term => text.toLowerCase().includes(term));
                    };
                    
                    // Helper function to check if an element is likely a search result
                    const isLikelySearchResult = (element) => {
                        // Check if it has a heading and link
                        const hasHeading = element.querySelector('h1, h2, h3, h4') !== null;
                        const hasLink = element.querySelector('a') !== null;
                        
                        // Check if it has substantial content
                        const hasContent = element.textContent.trim().length > 100;
                        
                        // Check if it's not in a sidebar
                        const notInSidebar = 
                            !element.closest('[class*="sidebar"], [id*="sidebar"], [class*="widget"], [class*="latest"], [class*="most-read"]') &&
                            !element.closest('[class*="footer"], [id*="footer"], [class*="header"], [id*="header"]') &&
                            !element.closest('nav, [role="navigation"]');
                        
                        return hasHeading && hasLink && hasContent && notInSidebar;
                    };
                    
                    // Find search result container
                    let searchContainer = null;
                    
                    // Method 1: Look for elements with search-related classes
                    const searchClassContainers = document.querySelectorAll('[class*="search-result"], [class*="search_result"], [class*="searchresult"], [class*="search-container"]');
                    if (searchClassContainers.length > 0) {
                        searchContainer = searchClassContainers[0];
                    }
                    
                    // Method 2: Look for headings that indicate search results
                    if (!searchContainer) {
                        const searchHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).filter(h => isSearchRelated(h.textContent));
                        if (searchHeadings.length > 0) {
                            // Get the parent container of the heading
                            searchContainer = searchHeadings[0].parentElement;
                            // Go up a few levels to find a container with multiple children
                            for (let i = 0; i < 3; i++) {
                                if (searchContainer && searchContainer.children.length > 3) {
                                    break;
                                }
                                if (searchContainer && searchContainer.parentElement) {
                                    searchContainer = searchContainer.parentElement;
                                }
                            }
                        }
                    }
                    
                    // Method 3: Look for elements with search in URL path that contain articles
                    if (!searchContainer && window.location.pathname.includes('search')) {
                        // Find the main content area
                        const mainContent = document.querySelector('main, [role="main"], [id*="content"], [class*="content"], [id*="main"], [class*="main"]');
                        if (mainContent) {
                            searchContainer = mainContent;
                        }
                    }
                    
                    // If we found a search container, extract the results
                    let results = [];
                    if (searchContainer) {
                        // Look for article elements or divs that look like search results
                        const potentialResults = [
                            ...Array.from(searchContainer.querySelectorAll('article')),
                            ...Array.from(searchContainer.querySelectorAll('div')).filter(isLikelySearchResult)
                        ];
                        
                        // Extract data from each result
                        results = potentialResults.map(element => {
                            // Extract title
                            let title = null;
                            let titleElement = null;
                            
                            // Try to find title in headings
                            const headings = element.querySelectorAll('h1, h2, h3, h4');
                            if (headings.length > 0) {
                                titleElement = headings[0];
                                title = titleElement.textContent.trim();
                            }
                            
                            // If no heading, try links with title-like classes
                            if (!title) {
                                const titleLinks = element.querySelectorAll('a[class*="title"], a[class*="headline"], a[class*="heading"]');
                                if (titleLinks.length > 0) {
                                    titleElement = titleLinks[0];
                                    title = titleElement.textContent.trim();
                                }
                            }
                            
                            // If still no title, try any link
                            if (!title) {
                                const links = element.querySelectorAll('a');
                                if (links.length > 0) {
                                    titleElement = links[0];
                                    title = titleElement.textContent.trim();
                                }
                            }
                            
                            // Extract link
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
                            
                            // If no link found yet, try other links
                            if (!link) {
                                const links = element.querySelectorAll('a');
                                if (links.length > 0) {
                                    link = links[0].href;
                                }
                            }
                            
                            // Extract date
                            let date = null;
                            
                            // Try time elements
                            const timeElements = element.querySelectorAll('time, [datetime]');
                            if (timeElements.length > 0) {
                                const timeEl = timeElements[0];
                                date = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
                            }
                            
                            // Try elements with date-like classes
                            if (!date) {
                                const dateElements = element.querySelectorAll('[class*="date"], [class*="time"], [class*="published"]');
                                if (dateElements.length > 0) {
                                    date = dateElements[0].textContent.trim();
                                }
                            }
                            
                            // Extract summary
                            let summary = null;
                            
                            // Try elements with summary-like classes
                            const summaryElements = element.querySelectorAll('[class*="summary"], [class*="excerpt"], [class*="description"], [class*="teaser"]');
                            if (summaryElements.length > 0) {
                                summary = summaryElements[0].textContent.trim();
                            }
                            
                            // Try paragraphs
                            if (!summary) {
                                const paragraphs = element.querySelectorAll('p');
                                if (paragraphs.length > 0) {
                                    summary = paragraphs[0].textContent.trim();
                                }
                            }
                            
                            // If still no summary, use the element's text content
                            if (!summary) {
                                // Get all text nodes that are direct children
                                const textNodes = Array.from(element.childNodes)
                                    .filter(node => node.nodeType === 3)
                                    .map(node => node.textContent.trim())
                                    .filter(text => text.length > 0);
                                
                                if (textNodes.length > 0) {
                                    summary = textNodes.join(' ');
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
                                    title: 'direct',
                                    link: 'direct',
                                    date: 'direct',
                                    summary: 'direct'
                                }
                            };
                        });
                    }
                    
                    // If no results found through search container, try a more generic approach
                    if (results.length === 0) {
                        // Look for any articles or article-like elements in the page
                        const articles = [
                            ...Array.from(document.querySelectorAll('article')),
                            ...Array.from(document.querySelectorAll('div')).filter(isLikelySearchResult)
                        ];
                        
                        // Extract data from each article
                        results = articles.map(element => {
                            // Same extraction logic as above
                            // Extract title
                            let title = null;
                            let titleElement = null;
                            
                            // Try to find title in headings
                            const headings = element.querySelectorAll('h1, h2, h3, h4');
                            if (headings.length > 0) {
                                titleElement = headings[0];
                                title = titleElement.textContent.trim();
                            }
                            
                            // If no heading, try links with title-like classes
                            if (!title) {
                                const titleLinks = element.querySelectorAll('a[class*="title"], a[class*="headline"], a[class*="heading"]');
                                if (titleLinks.length > 0) {
                                    titleElement = titleLinks[0];
                                    title = titleElement.textContent.trim();
                                }
                            }
                            
                            // If still no title, try any link
                            if (!title) {
                                const links = element.querySelectorAll('a');
                                if (links.length > 0) {
                                    titleElement = links[0];
                                    title = titleElement.textContent.trim();
                                }
                            }
                            
                            // Extract link
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
                            
                            // If no link found yet, try other links
                            if (!link) {
                                const links = element.querySelectorAll('a');
                                if (links.length > 0) {
                                    link = links[0].href;
                                }
                            }
                            
                            // Extract date
                            let date = null;
                            
                            // Try time elements
                            const timeElements = element.querySelectorAll('time, [datetime]');
                            if (timeElements.length > 0) {
                                const timeEl = timeElements[0];
                                date = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
                            }
                            
                            // Try elements with date-like classes
                            if (!date) {
                                const dateElements = element.querySelectorAll('[class*="date"], [class*="time"], [class*="published"]');
                                if (dateElements.length > 0) {
                                    date = dateElements[0].textContent.trim();
                                }
                            }
                            
                            // Extract summary
                            let summary = null;
                            
                            // Try elements with summary-like classes
                            const summaryElements = element.querySelectorAll('[class*="summary"], [class*="excerpt"], [class*="description"], [class*="teaser"]');
                            if (summaryElements.length > 0) {
                                summary = summaryElements[0].textContent.trim();
                            }
                            
                            // Try paragraphs
                            if (!summary) {
                                const paragraphs = element.querySelectorAll('p');
                                if (paragraphs.length > 0) {
                                    summary = paragraphs[0].textContent.trim();
                                }
                            }
                            
                            // If still no summary, use the element's text content
                            if (!summary) {
                                // Get all text nodes that are direct children
                                const textNodes = Array.from(element.childNodes)
                                    .filter(node => node.nodeType === 3)
                                    .map(node => node.textContent.trim())
                                    .filter(text => text.length > 0);
                                
                                if (textNodes.length > 0) {
                                    summary = textNodes.join(' ');
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
                                    title: 'generic',
                                    link: 'generic',
                                    date: 'generic',
                                    summary: 'generic'
                                }
                            };
                        });
                    }
                    
                    // Filter out results without title or link
                    return results.filter(result => result.title && result.link);
                });
                
                log.info(`Found ${searchResults.length} search results using direct approach`);
                
                // If we found results, save them
                if (searchResults.length > 0) {
                    methodsUsed.add('direct');
                    
                    // Log each result
                    searchResults.forEach((result, index) => {
                        log.info(`Result ${index + 1}: ${result.title}`);
                    });
                    
                    // Limit to maxItems if specified
                    const limitedResults = maxItems > 0 ? searchResults.slice(0, maxItems) : searchResults;
                    
                    // Save the results to the dataset
                    await dataset.pushData(limitedResults);
                    extractedCount += limitedResults.length;
                    
                    // Check if we've reached the maximum number of items
                    if (maxItems > 0 && extractedCount >= maxItems) {
                        log.info(`Reached maximum number of items (${maxItems}), stopping the crawler.`);
                        await crawler.stop();
                    }
                } else {
                    log.info('No search results found using direct approach, trying fallback methods...');
                    
                    // Fallback: Try to extract any article-like elements
                    const fallbackResults = await page.evaluate(() => {
                        // Helper function to check if an element is likely an article
                        const isLikelyArticle = (element) => {
                            // Check if it has a heading and link
                            const hasHeading = element.querySelector('h1, h2, h3, h4') !== null;
                            const hasLink = element.querySelector('a') !== null;
                            
                            // Check if it has substantial content
                            const hasContent = element.textContent.trim().length > 100;
                            
                            // Check if it's not in a sidebar
                            const notInSidebar = 
                                !element.closest('[class*="sidebar"], [id*="sidebar"], [class*="widget"], [class*="latest"], [class*="most-read"]') &&
                                !element.closest('[class*="footer"], [id*="footer"], [class*="header"], [id*="header"]') &&
                                !element.closest('nav, [role="navigation"]');
                            
                            return hasHeading && hasLink && hasContent && notInSidebar;
                        };
                        
                        // Find all article-like elements
                        const articles = [
                            ...Array.from(document.querySelectorAll('article')),
                            ...Array.from(document.querySelectorAll('div')).filter(isLikelyArticle)
                        ];
                        
                        // Extract data from each article
                        const results = articles.map(element => {
                            // Extract title
                            let title = null;
                            let titleElement = null;
                            
                            // Try to find title in headings
                            const headings = element.querySelectorAll('h1, h2, h3, h4');
                            if (headings.length > 0) {
                                titleElement = headings[0];
                                title = titleElement.textContent.trim();
                            }
                            
                            // If no heading, try links with title-like classes
                            if (!title) {
                                const titleLinks = element.querySelectorAll('a[class*="title"], a[class*="headline"], a[class*="heading"]');
                                if (titleLinks.length > 0) {
                                    titleElement = titleLinks[0];
                                    title = titleElement.textContent.trim();
                                }
                            }
                            
                            // If still no title, try any link
                            if (!title) {
                                const links = element.querySelectorAll('a');
                                if (links.length > 0) {
                                    titleElement = links[0];
                                    title = titleElement.textContent.trim();
                                }
                            }
                            
                            // Extract link
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
                            
                            // If no link found yet, try other links
                            if (!link) {
                                const links = element.querySelectorAll('a');
                                if (links.length > 0) {
                                    link = links[0].href;
                                }
                            }
                            
                            // Extract date
                            let date = null;
                            
                            // Try time elements
                            const timeElements = element.querySelectorAll('time, [datetime]');
                            if (timeElements.length > 0) {
                                const timeEl = timeElements[0];
                                date = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
                            }
                            
                            // Try elements with date-like classes
                            if (!date) {
                                const dateElements = element.querySelectorAll('[class*="date"], [class*="time"], [class*="published"]');
                                if (dateElements.length > 0) {
                                    date = dateElements[0].textContent.trim();
                                }
                            }
                            
                            // Extract summary
                            let summary = null;
                            
                            // Try elements with summary-like classes
                            const summaryElements = element.querySelectorAll('[class*="summary"], [class*="excerpt"], [class*="description"], [class*="teaser"]');
                            if (summaryElements.length > 0) {
                                summary = summaryElements[0].textContent.trim();
                            }
                            
                            // Try paragraphs
                            if (!summary) {
                                const paragraphs = element.querySelectorAll('p');
                                if (paragraphs.length > 0) {
                                    summary = paragraphs[0].textContent.trim();
                                }
                            }
                            
                            // If still no summary, use the element's text content
                            if (!summary) {
                                // Get all text nodes that are direct children
                                const textNodes = Array.from(element.childNodes)
                                    .filter(node => node.nodeType === 3)
                                    .map(node => node.textContent.trim())
                                    .filter(text => text.length > 0);
                                
                                if (textNodes.length > 0) {
                                    summary = textNodes.join(' ');
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
                                    title: 'fallback',
                                    link: 'fallback',
                                    date: 'fallback',
                                    summary: 'fallback'
                                }
                            };
                        });
                        
                        // Filter out results without title or link
                        return results.filter(result => result.title && result.link);
                    });
                    
                    log.info(`Found ${fallbackResults.length} results using fallback method`);
                    
                    // If we found results, save them
                    if (fallbackResults.length > 0) {
                        methodsUsed.add('fallback');
                        
                        // Log each result
                        fallbackResults.forEach((result, index) => {
                            log.info(`Result ${index + 1}: ${result.title}`);
                        });
                        
                        // Limit to maxItems if specified
                        const limitedResults = maxItems > 0 ? fallbackResults.slice(0, maxItems) : fallbackResults;
                        
                        // Save the results to the dataset
                        await dataset.pushData(limitedResults);
                        extractedCount += limitedResults.length;
                        
                        // Check if we've reached the maximum number of items
                        if (maxItems > 0 && extractedCount >= maxItems) {
                            log.info(`Reached maximum number of items (${maxItems}), stopping the crawler.`);
                            await crawler.stop();
                        }
                    }
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
