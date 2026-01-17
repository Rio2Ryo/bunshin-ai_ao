import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, FileDown, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface SlideData {
  slideNumber: number;
  title: string;
  content: string;
  keyPoints: string[];
}

interface NanoBananaData {
  slideContentFile: string;
  slideCount: number;
  slides: SlideData[];
  theme: string;
  twin1Name: string;
  twin2Name: string;
  compatibilityScore: number;
  sessionId: number;
}

// Color themes for slides
const slideThemes = [
  { bg: "from-blue-600 to-purple-700", text: "text-white" },
  { bg: "from-emerald-500 to-teal-600", text: "text-white" },
  { bg: "from-orange-500 to-red-600", text: "text-white" },
  { bg: "from-pink-500 to-rose-600", text: "text-white" },
  { bg: "from-indigo-600 to-blue-700", text: "text-white" },
  { bg: "from-cyan-500 to-blue-600", text: "text-white" },
  { bg: "from-violet-600 to-purple-700", text: "text-white" },
  { bg: "from-amber-500 to-orange-600", text: "text-white" },
  { bg: "from-lime-500 to-green-600", text: "text-white" },
  { bg: "from-fuchsia-500 to-pink-600", text: "text-white" },
];

export default function NanoBananaSlides() {
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id || "0");
  const [data, setData] = useState<NanoBananaData | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isExporting, setIsExporting] = useState(false);

  const exportPptxMutation = trpc.matching.exportPptx.useMutation({
    onSuccess: (data) => {
      // Download the PPTX file
      window.open(data.url, "_blank");
      toast.success("PPTXファイルをダウンロードしました");
    },
    onError: () => {
      toast.error("PPTXの生成に失敗しました");
    },
  });

  const handleExportPptx = () => {
    exportPptxMutation.mutate({ sessionId });
  };

  useEffect(() => {
    const stored = localStorage.getItem(`nano-banana-${sessionId}`);
    if (stored) {
      setData(JSON.parse(stored) as NanoBananaData);
    }
  }, [sessionId]);

  const nextSlide = () => {
    if (data && currentSlide < data.slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === " ") {
      nextSlide();
    } else if (e.key === "ArrowLeft") {
      prevSlide();
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentSlide, data?.slides.length]);

  const downloadMarkdown = () => {
    if (!data) return;
    const blob = new Blob([data.slideContentFile], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `presentation-${sessionId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Markdownファイルをダウンロードしました");
  };

  const exportToPDF = async () => {
    setIsExporting(true);
    try {
      // Create a printable version
      const printWindow = window.open("", "_blank");
      if (!printWindow || !data) {
        toast.error("PDFの生成に失敗しました");
        return;
      }

      const slidesHtml = data.slides.map((slide, index) => {
        const theme = slideThemes[index % slideThemes.length];
        return `
          <div class="slide" style="page-break-after: always; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; background: linear-gradient(135deg, ${theme.bg.includes('blue') ? '#3b82f6' : theme.bg.includes('emerald') ? '#10b981' : theme.bg.includes('orange') ? '#f97316' : theme.bg.includes('pink') ? '#ec4899' : theme.bg.includes('indigo') ? '#6366f1' : theme.bg.includes('cyan') ? '#06b6d4' : theme.bg.includes('violet') ? '#8b5cf6' : theme.bg.includes('amber') ? '#f59e0b' : theme.bg.includes('lime') ? '#84cc16' : '#d946ef'}, ${theme.bg.includes('purple') ? '#7c3aed' : theme.bg.includes('teal') ? '#14b8a6' : theme.bg.includes('red') ? '#ef4444' : theme.bg.includes('rose') ? '#f43f5e' : theme.bg.includes('blue') ? '#2563eb' : theme.bg.includes('blue') ? '#3b82f6' : theme.bg.includes('purple') ? '#7c3aed' : theme.bg.includes('orange') ? '#ea580c' : theme.bg.includes('green') ? '#22c55e' : '#ec4899'}); color: white; padding: 60px; text-align: center;">
            <h1 style="font-size: 48px; font-weight: bold; margin-bottom: 30px;">${slide.title}</h1>
            ${slide.content ? `<p style="font-size: 24px; margin-bottom: 30px; max-width: 800px;">${slide.content}</p>` : ''}
            ${slide.keyPoints.length > 0 ? `
              <ul style="list-style: none; padding: 0; font-size: 20px; text-align: left;">
                ${slide.keyPoints.map(point => `<li style="margin: 15px 0; padding-left: 30px; position: relative;">
                  <span style="position: absolute; left: 0;">✓</span> ${point}
                </li>`).join('')}
              </ul>
            ` : ''}
          </div>
        `;
      }).join('');

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${data.theme} - プレゼン資料</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Helvetica Neue', Arial, sans-serif; }
            @media print {
              .slide { page-break-after: always; }
            }
          </style>
        </head>
        <body>
          ${slidesHtml}
        </body>
        </html>
      `);
      printWindow.document.close();
      toast.success("PDF用のウィンドウを開きました。印刷ダイアログからPDFとして保存してください。");
    } catch (error) {
      toast.error("PDFの生成に失敗しました");
    } finally {
      setIsExporting(false);
    }
  };

  if (!data || data.slides.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-white text-lg">プレゼン資料を読み込んでいます...</p>
          <Link href={`/matching/${sessionId}`}>
            <Button variant="outline" className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              マッチング結果に戻る
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const currentSlideData = data.slides[currentSlide];
  const theme = slideThemes[currentSlide % slideThemes.length];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/30">
        <Link href={`/matching/${sessionId}`}>
          <Button variant="ghost" size="sm" className="text-white hover:text-white/80">
            <ArrowLeft className="h-4 w-4 mr-2" />
            戻る
          </Button>
        </Link>
        <div className="text-white text-sm font-medium">
          {data.theme} | {currentSlide + 1} / {data.slides.length}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="text-white hover:text-white/80" onClick={downloadMarkdown}>
            <Download className="h-4 w-4 mr-2" />
            MD
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-white hover:text-white/80" 
            onClick={exportToPDF}
            disabled={isExporting}
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            PDF
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="text-white hover:text-white/80" 
            onClick={handleExportPptx}
            disabled={exportPptxMutation.isPending}
          >
            {exportPptxMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 mr-2" />
            )}
            PPTX
          </Button>
        </div>
      </div>

      {/* Slide Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className={`w-full max-w-5xl aspect-[16/9] bg-gradient-to-br ${theme.bg} border-0 shadow-2xl overflow-hidden`}>
          <CardContent className="h-full flex flex-col items-center justify-center p-8 md:p-16 text-center">
            {/* Title */}
            <h1 className={`text-3xl md:text-5xl font-bold mb-6 ${theme.text}`}>
              {currentSlideData.title}
            </h1>

            {/* Subtitle / Content */}
            {currentSlideData.content && (
              <p className={`text-lg md:text-2xl mb-8 max-w-3xl opacity-90 ${theme.text}`}>
                {currentSlideData.content}
              </p>
            )}

            {/* Key Points */}
            {currentSlideData.keyPoints.length > 0 && (
              <ul className={`text-left space-y-4 ${theme.text}`}>
                {currentSlideData.keyPoints.map((point, index) => (
                  <li key={index} className="flex items-start gap-3 text-base md:text-xl">
                    <span className="text-2xl">✓</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Compatibility Score Badge (for first slide) */}
            {currentSlide === 0 && data.compatibilityScore > 0 && (
              <div className="mt-8 px-6 py-3 bg-white/20 rounded-full backdrop-blur-sm">
                <span className={`text-xl font-bold ${theme.text}`}>
                  相性スコア: {data.compatibilityScore}%
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-center gap-4 p-4 bg-black/30">
        <Button
          variant="outline"
          size="lg"
          onClick={prevSlide}
          disabled={currentSlide === 0}
          className="text-white border-white/30 hover:bg-white/10"
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
        
        {/* Slide Indicators */}
        <div className="flex gap-2 flex-wrap justify-center max-w-md">
          {data.slides.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`w-3 h-3 rounded-full transition-all ${
                index === currentSlide
                  ? "bg-primary scale-125"
                  : "bg-white/30 hover:bg-white/50"
              }`}
            />
          ))}
        </div>

        <Button
          variant="outline"
          size="lg"
          onClick={nextSlide}
          disabled={currentSlide === data.slides.length - 1}
          className="text-white border-white/30 hover:bg-white/10"
        >
          <ChevronRight className="h-6 w-6" />
        </Button>
      </div>

      {/* Keyboard Hint */}
      <div className="text-center text-white/50 text-sm pb-4">
        ← → キーまたはスペースキーでスライドを移動
      </div>
    </div>
  );
}
