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
        // Maximum time for each page
        navigationTimeoutSecs: 120,
        // Handler for each page
        async requestHandler({ page, request, log }) {
            log.info(`Processing ${request.url}...`);

            // Wait for the page to load
            await page.waitForLoadState('domcontentloaded');
            log.info('Page DOM content loaded');

            // Wait additional time for dynamic content to load
            log.info(`Waiting ${waitTime} seconds for dynamic content...`);
            await page.waitForTimeout(waitTime * 1000);
            log.info('Wait completed');

            // Save a screenshot for debugging
            await Actor.setValue('screenshot', await page.screenshot(), { contentType: 'image/png' });
            log.info('Screenshot saved');

            // Save HTML content for debugging
            await Actor.setValue('html', await page.content());
            log.info('HTML content saved');

            // Direct approach: Find all article-like elements
            const articleElements = await page.evaluate(() => {
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
                
                // Find all potential article elements in the main content area
                const allArticleLikeElements = Array.from(document.querySelectorAll('article, div > h2, div > h3'))
                    .filter(el => {
                        // For heading elements, get their parent
                        if (el.tagName === 'H2' || el.tagName === 'H3') {
                            return isLikelySearchResult(el.parentElement);
                        }
                        return isLikelySearchResult(el);
                    })
                    .map(el => {
                        // For heading elements, use their parent
                        if (el.tagName === 'H2' || el.tagName === 'H3') {
                            return el.parentElement;
                        }
                        return el;
                    });
                
                // Extract data from each potential article
                const results = allArticleLikeElements.map(element => {
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
                
                // Ensure results are unique by title
                const uniqueResults = [];
                const seenTitles = new Set();
                
                for (const result of results) {
                    if (result.title && !seenTitles.has(result.title)) {
                        uniqueResults.push(result);
                        seenTitles.add(result.title);
                    }
                }
                
                return uniqueResults.filter(result => result.title && result.link);
            });

            log.info(`Found ${articleElements.length} article elements`);

            // Process and store the extracted articles
            for (const article of articleElements) {
                // Skip if we've reached the maximum number of items
                if (maxItems > 0 && extractedCount >= maxItems) {
                    log.info(`Reached maximum number of items (${maxItems}), stopping extraction`);
                    break;
                }

                // Add extraction method to the set
                methodsUsed.add('direct');

                // Push the article to the dataset
                await dataset.pushData(article);
                extractedCount++;
            }

            log.info(`Extracted ${extractedCount} articles in total`);
        },
        // Handle errors
        failedRequestHandler({ request, error, log }) {
            log.error(`Request ${request.url} failed with error: ${error.message}`);
        },
    });

    // Add the URL to the queue
    await crawler.run([url]);

    // Get all the data from the dataset
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
