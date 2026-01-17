import PptxGenJS from "pptxgenjs";

interface SlideData {
  slideNumber: number;
  title: string;
  content: string;
  keyPoints: string[];
}

interface PptxInput {
  theme: string;
  twin1Name: string;
  twin2Name: string;
  compatibilityScore: number;
  slides: SlideData[];
}

// Color themes for slides (matching the frontend)
const slideThemes = [
  { bg: "3b82f6", accent: "7c3aed" }, // blue to purple
  { bg: "10b981", accent: "14b8a6" }, // emerald to teal
  { bg: "f97316", accent: "ef4444" }, // orange to red
  { bg: "ec4899", accent: "f43f5e" }, // pink to rose
  { bg: "6366f1", accent: "2563eb" }, // indigo to blue
  { bg: "06b6d4", accent: "3b82f6" }, // cyan to blue
  { bg: "8b5cf6", accent: "7c3aed" }, // violet to purple
  { bg: "f59e0b", accent: "ea580c" }, // amber to orange
  { bg: "84cc16", accent: "22c55e" }, // lime to green
  { bg: "d946ef", accent: "ec4899" }, // fuchsia to pink
];

/**
 * PPTXファイルを生成する
 */
export async function generatePptx(input: PptxInput): Promise<Buffer> {
  const pptx = new PptxGenJS();

  // Set presentation properties
  pptx.author = "分身AI";
  pptx.title = input.theme;
  pptx.subject = `${input.twin1Name} × ${input.twin2Name} ビジネスマッチング`;
  pptx.company = "分身AI";

  // Define slide master
  pptx.defineSlideMaster({
    title: "MAIN_SLIDE",
    background: { color: "1e293b" },
    objects: [],
  });

  for (let i = 0; i < input.slides.length; i++) {
    const slideData = input.slides[i];
    const theme = slideThemes[i % slideThemes.length];

    const slide = pptx.addSlide();

    // Set gradient-like background
    slide.background = { color: theme.bg };

    // Add title
    slide.addText(slideData.title, {
      x: 0.5,
      y: 0.5,
      w: "90%",
      h: 1.2,
      fontSize: 36,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    // Add content if exists
    let yPosition = 2;

    if (slideData.content) {
      slide.addText(slideData.content, {
        x: 0.5,
        y: yPosition,
        w: "90%",
        h: 1,
        fontSize: 20,
        color: "FFFFFF",
        align: "center",
        valign: "top",
      });
      yPosition += 1.2;
    }

    // Add key points
    if (slideData.keyPoints.length > 0) {
      const bulletPoints = slideData.keyPoints.map(point => ({
        text: point,
        options: {
          bullet: { type: "bullet" as const, code: "2713" }, // checkmark
          fontSize: 18,
          color: "FFFFFF",
        },
      }));

      slide.addText(bulletPoints, {
        x: 1,
        y: yPosition,
        w: "80%",
        h: 3,
        valign: "top",
      });
    }

    // Add compatibility score badge on first slide
    if (i === 0 && input.compatibilityScore > 0) {
      slide.addShape("roundRect" as any, {
        x: 3.5,
        y: 4.5,
        w: 3,
        h: 0.8,
        fill: { color: "FFFFFF", transparency: 80 },
      });

      slide.addText(`相性スコア: ${input.compatibilityScore}%`, {
        x: 3.5,
        y: 4.5,
        w: 3,
        h: 0.8,
        fontSize: 18,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });
    }

    // Add slide number
    slide.addText(`${i + 1} / ${input.slides.length}`, {
      x: "85%",
      y: "92%",
      w: 1,
      h: 0.3,
      fontSize: 10,
      color: "FFFFFF",
      align: "right",
    });
  }

  // Generate PPTX as base64
  const pptxData = await pptx.write({ outputType: "base64" });
  return Buffer.from(pptxData as string, "base64");
}
