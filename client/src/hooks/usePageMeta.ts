import { useEffect } from "react";

const SITE_NAME = "分身AI";
const BASE_URL = "https://bunshin-ai.pages.dev";
const DEFAULT_OG_IMAGE = `${BASE_URL}/icons/icon-512x512.png`;

interface PageMeta {
  title: string;
  description?: string;
  ogImage?: string;
  path?: string;
}

function setMetaTag(property: string, content: string) {
  const selector = property.startsWith("og:")
    ? `meta[property="${property}"]`
    : `meta[name="${property}"]`;
  let el = document.querySelector(selector);
  if (el) {
    el.setAttribute("content", content);
  } else {
    el = document.createElement("meta");
    if (property.startsWith("og:")) {
      el.setAttribute("property", property);
    } else {
      el.setAttribute("name", property);
    }
    el.setAttribute("content", content);
    document.head.appendChild(el);
  }
}

export function usePageMeta({ title, description, ogImage, path }: PageMeta) {
  useEffect(() => {
    const fullTitle = `${title} | ${SITE_NAME}`;
    document.title = fullTitle;

    if (description) {
      setMetaTag("description", description);
      setMetaTag("og:description", description);
      setMetaTag("twitter:description", description);
    }

    setMetaTag("og:title", fullTitle);
    setMetaTag("twitter:title", fullTitle);
    const image = ogImage || DEFAULT_OG_IMAGE;
    setMetaTag("og:image", image);
    setMetaTag("twitter:image", image);

    setMetaTag("twitter:card", ogImage ? "summary_large_image" : "summary");
    setMetaTag("og:type", "profile");
    setMetaTag("og:site_name", SITE_NAME);

    if (path) {
      setMetaTag("og:url", `${BASE_URL}${path}`);
      const canonical = document.querySelector("link[rel='canonical']");
      if (canonical) canonical.setAttribute("href", `${BASE_URL}${path}`);
    }

    return () => {
      document.title = `${SITE_NAME} - Digital Twin AI System`;
    };
  }, [title, description, ogImage, path]);
}
