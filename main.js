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

    const { url, maxItems = 0, waitTime = 30 } = input; // Increased default wait time
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
                await page.screenshot({ path: 'screenshot.jpg', fullPage: true });
                log.info('Took screenshot for debugging');

                // Get the HTML content of the page
                const html = await page.content();
                
                // Save HTML for debugging
                await Actor.setValue('page-html', html);
                log.info('Saved HTML content for debugging');
                
                // Debug: Log the page title
                const pageTitle = await page.title();
                log.info(`Page title: ${pageTitle}`);

                // Debug: Check if we're on a search results page
                const isSearchPage = await page.evaluate(() => {
                    return document.body.textContent.includes('Search Results');
                });
                log.info(`Is search page: ${isSearchPage}`);

                // Debug: Check for specific Al Jazeera elements
                const hasSearchResults = await page.evaluate(() => {
                    return !!document.querySelector('.gc__content-container');
                });
                log.info(`Has search results container: ${hasSearchResults}`);

                // First approach: Look specifically for Al Jazeera search results
                log.info('Detecting article elements using Al Jazeera specific selectors...');
                
                // Debug: Count all potential article containers
                const articleCount = await page.evaluate(() => {
                    const containers = [
                        document.querySelectorAll('.gc__content-container article').length,
                        document.querySelectorAll('.gc__content-container .gc__header-wrap').length,
                        document.querySelectorAll('.gc__content').length
                    ];
                    return JSON.stringify(containers);
                });
                log.info(`Article container counts: ${articleCount}`);
                
                // Try to extract using Al Jazeera specific selectors
                const articles = await page.$$eval('.gc__content-container article, .gc__content', 
                    (elements) => {
                        console.log(`Found ${elements.length} elements with specific selectors`);
                        return elements.map((el, index) => {
                            return {
                                element: index,
                                method: 'alJazeeraSpecific',
                                confidence: 0.9,
                                selector: `.gc__content-container article:nth-child(${index + 1}), .gc__content:nth-child(${index + 1})`
                            };
                        });
                    }
                );
                
                log.info(`Detected ${articles.length} potential article elements`);
                
                // Extract data from each article
                const newsItems = [];
                const baseUrl = request.url;
                
                // Process each detected article
                for (let i = 0; i < articles.length; i++) {
                    if (maxItems > 0 && newsItems.length >= maxItems) {
                        break;
                    }
                    
                    const article = articles[i];
                    log.info(`Extracting data from article ${i+1}/${articles.length}`);
                    
                    // Debug: Log the article element's HTML
                    const articleHtml = await page.evaluate((index) => {
                        const elements = document.querySelectorAll('.gc__content-container article, .gc__content');
                        return elements[index] ? elements[index].outerHTML : 'Element not found';
                    }, i);
                    log.info(`Article ${i+1} HTML structure: ${articleHtml.substring(0, 100)}...`);
                    
                    // Extract data with detailed logging
                    const articleData = await page.evaluate((index) => {
                        // Find the article element
                        const elements = document.querySelectorAll('.gc__content-container article, .gc__content');
                        const element = elements[index];
                        
                        if (!element) {
                            console.log('Element not found');
                            return null;
                        }
                        
                        // Debug logs
                        const debugInfo = {};
                        
                        // Extract title and link
                        const titleElement = element.querySelector('.gc__title-link, .gc__title a');
                        debugInfo.titleElementFound = !!titleElement;
                        debugInfo.titleElementTag = titleElement ? titleElement.tagName : 'N/A';
                        debugInfo.titleElementClasses = titleElement ? titleElement.className : 'N/A';
                        
                        const title = titleElement ? titleElement.textContent.trim() : null;
                        debugInfo.titleText = title;
                        
                        const link = titleElement && titleElement.href ? titleElement.href : null;
                        debugInfo.linkHref = link;
                        
                        // Extract date
                        const dateElement = element.querySelector('.gc__date, .gc__iab-wrap time');
                        debugInfo.dateElementFound = !!dateElement;
                        debugInfo.dateElementTag = dateElement ? dateElement.tagName : 'N/A';
                        debugInfo.dateElementClasses = dateElement ? dateElement.className : 'N/A';
                        
                        const date = dateElement ? dateElement.textContent.trim() : null;
                        debugInfo.dateText = date;
                        
                        // Extract summary
                        const summaryElement = element.querySelector('.gc__excerpt, .gc__body-wrap');
                        debugInfo.summaryElementFound = !!summaryElement;
                        debugInfo.summaryElementTag = summaryElement ? summaryElement.tagName : 'N/A';
                        debugInfo.summaryElementClasses = summaryElement ? summaryElement.className : 'N/A';
                        
                        const summary = summaryElement ? summaryElement.textContent.trim() : null;
                        debugInfo.summaryText = summary;
                        
                        console.log('Debug info:', JSON.stringify(debugInfo));
                        
                        return {
                            title,
                            link,
                            date,
                            summary,
                            debugInfo,
                            confidence: {
                                title: title ? 0.9 : 0,
                                link: link ? 0.9 : 0,
                                date: date ? 0.8 : 0,
                                summary: summary ? 0.8 : 0,
                                overall: title && link ? 0.85 : 0.5
                            },
                            methods: {
                                title: 'alJazeeraSpecific',
                                link: 'alJazeeraSpecific',
                                date: 'alJazeeraSpecific',
                                summary: 'alJazeeraSpecific'
                            }
                        };
                    }, i);
                    
                    // Log debug info
                    if (articleData) {
                        log.info(`Article ${i+1} debug info: ${JSON.stringify(articleData.debugInfo)}`);
                        
                        // Only add if we have at least a title and link
                        if (articleData.title && articleData.link) {
                            delete articleData.debugInfo; // Remove debug info before saving
                            newsItems.push(articleData);
                            methodsUsed.add('alJazeeraSpecific');
                            log.info(`Successfully extracted article: ${articleData.title}`);
                        } else {
                            log.info(`Failed to extract required fields for article ${i+1}`);
                        }
                    } else {
                        log.info(`No data extracted for article ${i+1}`);
                    }
                }
                
                // If no articles were detected or extracted, try a more generic approach
                if (newsItems.length === 0) {
                    log.info('No articles detected with primary method, trying alternative approach...');
                    
                    // Try to find any elements that look like news items
                    const genericArticles = await page.$$eval('div.gc__content-container > div, .search-result, .search-results > div', 
                        (elements) => {
                            console.log(`Found ${elements.length} elements with generic selectors`);
                            return elements.map((el, index) => {
                                return {
                                    element: index,
                                    method: 'genericSelector',
                                    confidence: 0.7,
                                    selector: `div:nth-child(${index + 1})`
                                };
                            });
                        }
                    );
                    
                    log.info(`Detected ${genericArticles.length} potential generic elements`);
                    
                    // Process each generic element
                    for (let i = 0; i < genericArticles.length; i++) {
                        if (maxItems > 0 && newsItems.length >= maxItems) {
                            break;
                        }
                        
                        const article = genericArticles[i];
                        log.info(`Extracting data from generic element ${i+1}/${genericArticles.length}`);
                        
                        // Extract data using generic selectors
                        const articleData = await page.evaluate((index) => {
                            // Find the element
                            const elements = document.querySelectorAll('div.gc__content-container > div, .search-result, .search-results > div');
                            const element = elements[index];
                            
                            if (!element) return null;
                            
                            // Debug logs
                            const debugInfo = {};
                            
                            // Extract title and link
                            const titleElement = element.querySelector('a, h1, h2, h3, h4, [class*="title"], [class*="headline"]');
                            debugInfo.titleElementFound = !!titleElement;
                            debugInfo.titleElementTag = titleElement ? titleElement.tagName : 'N/A';
                            debugInfo.titleElementClasses = titleElement ? titleElement.className : 'N/A';
                            
                            const title = titleElement ? titleElement.textContent.trim() : null;
                            debugInfo.titleText = title;
                            
                            const link = titleElement && titleElement.href ? titleElement.href : null;
                            debugInfo.linkHref = link;
                            
                            // Extract date
                            const dateElement = element.querySelector('time, [class*="date"], [class*="time"]');
                            debugInfo.dateElementFound = !!dateElement;
                            debugInfo.dateElementTag = dateElement ? dateElement.tagName : 'N/A';
                            debugInfo.dateElementClasses = dateElement ? dateElement.className : 'N/A';
                            
                            const date = dateElement ? dateElement.textContent.trim() : null;
                            debugInfo.dateText = date;
                            
                            // Extract summary
                            const summaryElement = element.querySelector('p, [class*="summary"], [class*="excerpt"], [class*="description"]');
                            debugInfo.summaryElementFound = !!summaryElement;
                            debugInfo.summaryElementTag = summaryElement ? summaryElement.tagName : 'N/A';
                            debugInfo.summaryElementClasses = summaryElement ? summaryElement.className : 'N/A';
                            
                            const summary = summaryElement ? summaryElement.textContent.trim() : null;
                            debugInfo.summaryText = summary;
                            
                            console.log('Generic debug info:', JSON.stringify(debugInfo));
                            
                            return {
                                title,
                                link,
                                date,
                                summary,
                                debugInfo,
                                confidence: {
                                    title: title ? 0.7 : 0,
                                    link: link ? 0.7 : 0,
                                    date: date ? 0.6 : 0,
                                    summary: summary ? 0.6 : 0,
                                    overall: title && link ? 0.65 : 0.4
                                },
                                methods: {
                                    title: 'genericSelector',
                                    link: 'genericSelector',
                                    date: 'genericSelector',
                                    summary: 'genericSelector'
                                }
                            };
                        }, i);
                        
                        // Log debug info
                        if (articleData) {
                            log.info(`Generic element ${i+1} debug info: ${JSON.stringify(articleData.debugInfo)}`);
                            
                            // Only add if we have at least a title and link
                            if (articleData.title && articleData.link) {
                                delete articleData.debugInfo; // Remove debug info before saving
                                newsItems.push(articleData);
                                methodsUsed.add('genericSelector');
                                log.info(`Successfully extracted generic element: ${articleData.title}`);
                            } else {
                                log.info(`Failed to extract required fields for generic element ${i+1}`);
                            }
                        } else {
                            log.info(`No data extracted for generic element ${i+1}`);
                        }
                    }
                }
                
                // Log the number of extracted items
                log.info(`Successfully extracted ${newsItems.length} news items`);
                
                // Save the results to the dataset
                await dataset.pushData(newsItems);
                extractedCount += newsItems.length;

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
