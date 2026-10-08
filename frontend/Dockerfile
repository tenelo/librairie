# Étape 1 : compilation des deux PWA Angular
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build backoffice && npx ng build boutique

# Étape 2 : service statique par nginx
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/backoffice/browser /usr/share/nginx/html/backoffice
COPY --from=build /app/dist/boutique/browser /usr/share/nginx/html/boutique
EXPOSE 8080 8081
