FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production


RUN apk add --no-cache ffmpeg python3 py3-pip

RUN pip3 install --break-system-packages yt-dlp

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY openapi.yaml ./
EXPOSE 3000
CMD ["node","dist/API.js"]
