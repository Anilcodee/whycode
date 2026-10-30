import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(),{name:'development-sitemap',configureServer(server){
    server.middlewares.use('/sitemap.xml',(_request,response)=>{
      response.setHeader('Content-Type','application/xml');
      response.end('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost:5173/</loc></url><url><loc>http://localhost:5173/help</loc></url></urlset>');
    });
  }}],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
