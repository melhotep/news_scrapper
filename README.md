# Adaptive News Scraper Actor

This Apify actor scrapes news items from various dynamic news sites, automatically detecting and extracting title, link, date, and summary for each news item without requiring manual configuration.

## Features

- **Universal Compatibility**: Works across various news sites without needing site-specific selectors
- **Intelligent Detection**: Uses multiple methods to identify news articles
- **Robust Extraction**: Employs multiple strategies with fallbacks to extract each field
- **Smart Features**: Uniqueness enforcement, confidence scoring, and detailed statistics
- **Debugging Support**: Screenshot capture, HTML content saving, and detailed logging

## Input Parameters

The actor accepts the following input parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | String | **Required**. URL of the news site to scrape |
| `maxItems` | Number | Maximum number of items to extract (0 for unlimited) |
| `waitTime` | Number | Wait time in seconds for dynamic content to load (default: 30) |

## Output Format

The actor outputs a JSON object with the following structure:

```json
{
  "newsItems": [
    {
      "title": "Article title",
      "link": "https://example.com/article",
      "date": "Publication date",
      "summary": "Article summary or excerpt",
      "confidence": {
        "title": 0.9,
        "link": 0.9,
        "date": 0.8,
        "summary": 0.8,
        "overall": 0.85
      },
      "methods": {
        "title": "direct",
        "link": "direct",
        "date": "direct",
        "summary": "direct"
      }
    }
  ],
  "totalCount": 10,
  "url": "https://example.com/news",
  "extractionStats": {
    "methodsUsed": ["direct"],
    "successRate": 0.8,
    "completeItems": 8,
    "partialItems": 2
  }
}
```

## Usage

### Running on Apify Platform

1. Create a new actor on the Apify platform
2. Set the source to your GitHub repository
3. Add a Dockerfile with the following content:

```dockerfile
FROM apify/actor-node-playwright:20

# Copy all files from the actor directory
COPY . ./

# Install all dependencies and build the code
RUN npm install --quiet --only=prod --no-optional

# Run the actor
CMD ["node", "main.js"]
```

4. Build the actor
5. Run the actor with the following input:

```json
{
  "url": "https://example.com/news",
  "maxItems": 10,
  "waitTime": 30
}
```

### Running Locally

1. Clone the repository
2. Install dependencies: `npm install`
3. Run the actor: `node main.js`

## How It Works

The actor uses a sophisticated approach to extract news items:

1. **Page Loading**: Waits for the page to load completely, including dynamic content
2. **Article Detection**: Uses multiple strategies to identify news article elements
3. **Data Extraction**: Extracts title, link, date, and summary using various methods
4. **Result Processing**: Ensures uniqueness, calculates confidence scores, and provides statistics

## Troubleshooting

If the actor is not extracting news items from a particular site:

1. Increase the `waitTime` parameter to allow more time for dynamic content to load
2. Check the debug artifacts (screenshot and HTML) in the Key-Value store
3. Review the extraction statistics in the output to identify which methods were used

## License

ISC
