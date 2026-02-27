import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { Streamdown } from "streamdown";

interface PresentationData {
  markdown: string;
  slideCount: number;
  sessionId: number;
}

export default function Presentation() {
  usePageMeta({ title: "プレゼンテーション", description: "マッチング結果のプレゼンテーション" });
  const { id } = useParams<{ id: string }>();
  const sessionId = parseInt(id || "0");
  const [presentationData, setPresentationData] = useState<PresentationData | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slides, setSlides] = useState<string[]>([]);

  useEffect(() => {
    // Load presentation data from localStorage
    const stored = localStorage.getItem(`presentation-${sessionId}`);
    if (stored) {
      const data = JSON.parse(stored) as PresentationData;
      setPresentationData(data);
      // Split markdown into slides
      const slideArray = data.markdown.split(/\n---\n/).map(s => s.trim()).filter(s => s.length > 0);
      setSlides(slideArray);
    }
  }, [sessionId]);

  const nextSlide = () => {
    if (currentSlide < slides.length - 1) {
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
  }, [currentSlide, slides.length]);

  const downloadMarkdown = () => {
    if (!presentationData) return;
    const blob = new Blob([presentationData.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `presentation-${sessionId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!presentationData || slides.length === 0) {
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
        <div className="text-white text-sm">
          {currentSlide + 1} / {slides.length}
        </div>
        <Button variant="ghost" size="sm" className="text-white hover:text-white/80" onClick={downloadMarkdown}>
          <Download className="h-4 w-4 mr-2" />
          Markdown
        </Button>
      </div>

      {/* Slide Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="w-full max-w-4xl aspect-[16/9] bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 shadow-2xl">
          <CardContent className="h-full flex items-center justify-center p-8 md:p-12">
            <div className="prose prose-invert prose-lg max-w-none w-full text-center">
              <Streamdown>{slides[currentSlide]}</Streamdown>
            </div>
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
        <div className="flex gap-2">
          {slides.map((_, index) => (
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
          disabled={currentSlide === slides.length - 1}
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
