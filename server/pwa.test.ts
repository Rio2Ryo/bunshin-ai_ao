import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('PWA Configuration', () => {
  const publicDir = path.join(__dirname, '../client/public');

  describe('manifest.json', () => {
    it('should exist', () => {
      const manifestPath = path.join(publicDir, 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
    });

    it('should have valid JSON structure', () => {
      const manifestPath = path.join(publicDir, 'manifest.json');
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      
      expect(manifest.name).toBe('分身AI - Digital Twin AI System');
      expect(manifest.short_name).toBe('分身AI');
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBe('/');
      expect(manifest.theme_color).toBe('#6366f1');
      expect(manifest.background_color).toBe('#0f172a');
    });

    it('should have required icons', () => {
      const manifestPath = path.join(publicDir, 'manifest.json');
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      
      expect(manifest.icons).toBeDefined();
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThan(0);
      
      // Check for required icon sizes
      const sizes = manifest.icons.map((icon: any) => icon.sizes);
      expect(sizes).toContain('192x192');
      expect(sizes).toContain('512x512');
    });
  });

  describe('Service Worker', () => {
    it('should exist', () => {
      const swPath = path.join(publicDir, 'sw.js');
      expect(fs.existsSync(swPath)).toBe(true);
    });

    it('should have cache configuration', () => {
      const swPath = path.join(publicDir, 'sw.js');
      const content = fs.readFileSync(swPath, 'utf-8');
      
      expect(content).toContain('CACHE_NAME');
      expect(content).toContain('install');
      expect(content).toContain('activate');
      expect(content).toContain('fetch');
    });

    it('should have offline handling', () => {
      const swPath = path.join(publicDir, 'sw.js');
      const content = fs.readFileSync(swPath, 'utf-8');
      
      expect(content).toContain('offline');
      expect(content).toContain('networkFirst');
      expect(content).toContain('cacheFirst');
    });

    it('should have push notification handling', () => {
      const swPath = path.join(publicDir, 'sw.js');
      const content = fs.readFileSync(swPath, 'utf-8');
      
      expect(content).toContain('push');
      expect(content).toContain('notificationclick');
    });
  });

  describe('Offline Page', () => {
    it('should exist', () => {
      const offlinePath = path.join(publicDir, 'offline.html');
      expect(fs.existsSync(offlinePath)).toBe(true);
    });

    it('should have proper content', () => {
      const offlinePath = path.join(publicDir, 'offline.html');
      const content = fs.readFileSync(offlinePath, 'utf-8');
      
      expect(content).toContain('オフライン');
      expect(content).toContain('分身AI');
      expect(content).toContain('再読み込み');
    });
  });

  describe('App Icons', () => {
    const requiredSizes = [72, 96, 128, 144, 152, 192, 384, 512];
    
    requiredSizes.forEach(size => {
      it(`should have ${size}x${size} icon`, () => {
        const iconPath = path.join(publicDir, 'icons', `icon-${size}x${size}.png`);
        expect(fs.existsSync(iconPath)).toBe(true);
      });
    });

    it('should have apple-touch-icon', () => {
      const iconPath = path.join(publicDir, 'icons', 'apple-touch-icon.png');
      expect(fs.existsSync(iconPath)).toBe(true);
    });
  });

  describe('HTML Meta Tags', () => {
    it('should have PWA meta tags in index.html', () => {
      const indexPath = path.join(__dirname, '../client/index.html');
      const content = fs.readFileSync(indexPath, 'utf-8');
      
      expect(content).toContain('manifest.json');
      expect(content).toContain('theme-color');
      expect(content).toContain('apple-mobile-web-app-capable');
      expect(content).toContain('apple-touch-icon');
    });
  });
});
