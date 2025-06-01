/**
 * Test script for the Adaptive News Scraper Actor
 * 
 * This script demonstrates how to test the actor locally
 * with multiple sample news sites.
 */

// Sample news sites for testing
const testSites = [
    {
        name: "Al Jazeera Search",
        url: "https://www.aljazeera.com/search/iraq%20oil?sort=date",
        maxItems: 5,
        waitTime: 10
    },
    {
        name: "BBC News",
        url: "https://www.bbc.com/news",
        maxItems: 5,
        waitTime: 10
    },
    {
        name: "CNN",
        url: "https://www.cnn.com",
        maxItems: 5,
        waitTime: 10
    },
    {
        name: "The Guardian",
        url: "https://www.theguardian.com/international",
        maxItems: 5,
        waitTime: 10
    },
    {
        name: "Reuters",
        url: "https://www.reuters.com",
        maxItems: 5,
        waitTime: 10
    }
];

// Function to run tests sequentially
async function runTests() {
    console.log("Starting adaptive news scraper tests...");
    
    for (const site of testSites) {
        console.log(`\n=== Testing ${site.name} (${site.url}) ===\n`);
        
        // Set environment variables for testing
        process.env.APIFY_INPUT_JSON = JSON.stringify({
            url: site.url,
            maxItems: site.maxItems,
            waitTime: site.waitTime
        });
        
        try {
            // Run the main actor script
            await require('./main.js');
            console.log(`\n✓ Test completed for ${site.name}\n`);
        } catch (error) {
            console.error(`\n✗ Test failed for ${site.name}: ${error.message}\n`);
        }
    }
    
    console.log("\nAll tests completed!");
}

// Run the tests
runTests().catch(console.error);
