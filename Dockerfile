FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http=require('node:http');const port=process.env.PORT||8080;const url='http://127.0.0.1:'+port+'/api/health';const req=http.get(url,(res)=>{process.exit(res.statusCode===200?0:1)});req.setTimeout(4000,()=>{req.destroy();process.exit(1)});req.on('error',()=>process.exit(1));"

CMD ["node", "src/server.js"]
