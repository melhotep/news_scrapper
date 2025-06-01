FROM apify/actor-node-playwright:20

# Copy all files from the actor directory
COPY . ./

# Install all dependencies and build the code
RUN npm install --quiet --only=prod --no-optional

# Run the actor
CMD ["node", "main.js"]
