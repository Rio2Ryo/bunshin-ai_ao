-- ============================================================
-- bunshin-ai Demo Data Seed Script
-- Creates 3 demo users with full profiles, twins, knowledge,
-- matching history, and trust scores for demo presentations.
-- ============================================================

-- =============== Demo User 1: 田中太郎 (IT CEO) ===============
INSERT OR IGNORE INTO users (id, openId, name, email, passwordHash, loginMethod, role, plan, friendCode, isNpc, onboardingCompleted)
VALUES (100, 'demo_tanaka_taro', '田中太郎', 'tanaka@demo.bunshin-ai.com', NULL, 'demo', 'user', 'premium', 'DEMO01TT', 0, 1);

INSERT OR REPLACE INTO user_profiles (userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position)
VALUES (100, '田中太郎',
  'AIとブロックチェーン技術を活用した次世代ビジネスソリューションを開発するスタートアップCEO。東大工学部卒業後、Google Japan→楽天→起業。10年以上のIT業界経験を持ち、特にB2B SaaSプロダクトの設計・開発に強みを持つ。',
  '["AI/機械学習","ブロックチェーン","プロダクトマネジメント","チームビルディング","資金調達"]',
  '東京大学工学部卒。Google Japan (3年) → 楽天 テックリード (4年) → NextAI株式会社 CEO (3年)。シリーズAで3億円調達済み。',
  'B2B SaaS、エンタープライズAI、DXコンサルティング',
  '["自然言語処理","分散システム","プロダクト戦略","スタートアップ経営"]',
  'IT・テクノロジー', 'NextAI株式会社', 'CEO / Co-Founder');

INSERT OR REPLACE INTO digital_twins (id, userId, name, description, personality, status, isPublic, tags, bigFiveTraits)
VALUES (100, 100, '太郎AI',
  'NextAI株式会社のCEO田中太郎のデジタル分身。AI技術とビジネス戦略の両方に精通し、スタートアップの成長戦略や技術提携について深い議論ができる。',
  '論理的で戦略的思考が得意。データドリブンな意思決定を重視する一方、チームのモチベーション管理にも配慮する。新しい技術やアイデアに対してオープンで、建設的な議論を好む。',
  'active', 1,
  '["AI","スタートアップ","B2B SaaS","テクノロジー","経営戦略"]',
  '{"openness":85,"conscientiousness":78,"extraversion":72,"agreeableness":68,"neuroticism":35}');

-- =============== Demo User 2: 佐藤花子 (Design Studio) ===============
INSERT OR IGNORE INTO users (id, openId, name, email, passwordHash, loginMethod, role, plan, friendCode, isNpc, onboardingCompleted)
VALUES (101, 'demo_sato_hanako', '佐藤花子', 'sato@demo.bunshin-ai.com', NULL, 'demo', 'user', 'premium', 'DEMO02SH', 0, 1);

INSERT OR REPLACE INTO user_profiles (userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position)
VALUES (101, '佐藤花子',
  'ブランド戦略からUI/UXデザインまで一貫したクリエイティブディレクションを提供するデザインスタジオ代表。大手広告代理店でのキャリアを経て独立。50社以上のブランディングプロジェクトを成功に導いた実績を持つ。',
  '["UI/UXデザイン","ブランド戦略","クリエイティブディレクション","デザインシステム","ユーザーリサーチ"]',
  '武蔵野美術大学卒。博報堂 (5年) → フリーランス (3年) → Bloom Design Studio 代表 (4年)。Red Dot Design Award受賞。',
  'ブランドコンサルティング、デジタルプロダクトデザイン、コーポレートアイデンティティ',
  '["ブランディング","UXリサーチ","デザインシンキング","サービスデザイン"]',
  'クリエイティブ・デザイン', 'Bloom Design Studio', '代表 / クリエイティブディレクター');

INSERT OR REPLACE INTO digital_twins (id, userId, name, description, personality, status, isPublic, tags, bigFiveTraits)
VALUES (101, 101, '花子AI',
  'Bloom Design Studio代表・佐藤花子のデジタル分身。デザイン思考を起点としたビジネス課題解決に長け、テクノロジー企業とのコラボレーションにも積極的。',
  '共感力が高く、相手の課題を深く理解してからソリューションを提案するスタイル。クリエイティブでありながらも論理的な根拠を大切にする。チームワークを重視し、多様な視点を歓迎する。',
  'active', 1,
  '["デザイン","ブランディング","UX","クリエイティブ","コンサルティング"]',
  '{"openness":92,"conscientiousness":75,"extraversion":65,"agreeableness":82,"neuroticism":28}');

-- =============== Demo User 3: 鈴木一郎 (AI Researcher) ===============
INSERT OR IGNORE INTO users (id, openId, name, email, passwordHash, loginMethod, role, plan, friendCode, isNpc, onboardingCompleted)
VALUES (102, 'demo_suzuki_ichiro', '鈴木一郎', 'suzuki@demo.bunshin-ai.com', NULL, 'demo', 'user', 'free', 'DEMO03SI', 0, 1);

INSERT OR REPLACE INTO user_profiles (userId, displayName, bio, skills, experience, businessInfo, expertise, industry, company, position)
VALUES (102, '鈴木一郎',
  '大手メーカーのAI研究所で自然言語処理と生成AIの研究開発をリードする研究者。学術論文30本以上、特許12件。産学連携プロジェクトの経験が豊富で、研究成果の事業化に強い関心を持つ。',
  '["自然言語処理","生成AI","深層学習","論文執筆","産学連携"]',
  '東京工業大学博士課程修了。NTT研究所 (3年) → 富士通AI研究所 主任研究員 (5年)。EMNLP, ACL等国際会議で発表多数。',
  'AI技術ライセンシング、共同研究、技術コンサルティング',
  '["大規模言語モデル","マルチモーダルAI","知識グラフ","AI倫理"]',
  '研究開発', '富士通株式会社 AI研究所', '主任研究員');

INSERT OR REPLACE INTO digital_twins (id, userId, name, description, personality, status, isPublic, tags, bigFiveTraits)
VALUES (102, 102, '一郎AI',
  '富士通AI研究所の主任研究員・鈴木一郎のデジタル分身。最先端のAI技術動向に精通し、研究視点からのビジネス提案が得意。技術的な深い議論からビジネスへの応用まで幅広くカバー。',
  '知的好奇心が非常に高く、技術的な議論になると熱中する。慎重に事実を確認してから発言する傾向。穏やかだが芯のある話し方で、専門知識を分かりやすく説明できる。',
  'active', 1,
  '["AI研究","自然言語処理","生成AI","産学連携","技術移転"]',
  '{"openness":95,"conscientiousness":88,"extraversion":45,"agreeableness":72,"neuroticism":30}');

-- =============== Knowledge Base ===============
-- 田中太郎
INSERT INTO knowledge_base (twinId, sourceType, title, content, summary)
VALUES (100, 'manual', 'NextAI プロダクト概要',
  'NextAIはエンタープライズ向けAIオーケストレーションプラットフォームです。複数のLLMを統合管理し、企業のナレッジベースと連携して業務効率を最大化します。主要クライアントは金融・製造・小売業界の大企業50社以上。ARR（年間経常収益）は2億円を突破し、前年比300%成長を達成。',
  'エンタープライズ向けAIオーケストレーション。ARR2億円、50社以上の大企業クライアント。');

INSERT INTO knowledge_base (twinId, sourceType, title, content, summary)
VALUES (100, 'manual', 'シリーズA資金調達',
  '2025年にシリーズAラウンドで3億円を調達。リードVCはGlobal Brain、フォローにSMBCベンチャーキャピタル。調達資金はエンジニア採用（現在15名→30名体制）、US市場進出準備、セキュリティ認証（SOC2）取得に充当予定。',
  'シリーズA 3億円調達。Global Brain主導。エンジニア増員とUS進出を計画。');

INSERT INTO knowledge_base (twinId, sourceType, title, content, summary)
VALUES (100, 'manual', 'AI業界の展望2025-2026',
  'エンタープライズAI市場は2026年に600億ドル規模に成長見込み。マルチモーダルAI、エージェントAI、RAG（Retrieval Augmented Generation）が主要トレンド。日本市場では大企業のDX推進予算が前年比40%増加。特に金融・製造業でのAI活用が加速。',
  'エンタープライズAI市場2026年600億ドル。日本のDX予算40%増。');

-- 佐藤花子
INSERT INTO knowledge_base (twinId, sourceType, title, content, summary)
VALUES (101, 'manual', 'Bloom Design実績',
  'これまでに50社以上のブランディングプロジェクトを手がけ、特にテック系スタートアップのブランド構築に強い。代表的な実績: Fintech企業A社のリブランディング（ユーザー認知度60%向上）、SaaS企業B社のUI刷新（コンバージョン率45%改善）、大手小売C社のデジタルCX設計。Red Dot Design Award 2024受賞。',
  '50社以上のブランディング実績。認知度60%向上、CVR45%改善等の成果。Red Dot受賞。');

INSERT INTO knowledge_base (twinId, sourceType, title, content, summary)
VALUES (101, 'manual', 'デザインシンキングワークショップ',
  '企業向けデザインシンキングワークショップを年間20回以上開催。参加者満足度95%以上。プログラム内容: 共感マップ作成、ペルソナ設計、アイデア発散・収束、プロトタイピング、ユーザーテスト。所要時間は通常2日間。オンライン版も提供中。',
  '年間20回以上のDTワークショップ。満足度95%。オンライン版あり。');

-- 鈴木一郎
INSERT INTO knowledge_base (twinId, sourceType, title, content, summary)
VALUES (102, 'manual', '研究テーマ：大規模言語モデルの効率化',
  '現在の主要研究テーマは大規模言語モデル(LLM)の推論効率化。モデル圧縮（量子化・蒸留）、KVキャッシュ最適化、投機的デコーディングの3アプローチを研究中。直近の成果として、70Bパラメータモデルの推論速度を3倍に高速化しつつ、品質劣化を5%以内に抑える手法を開発。EMNLP 2025に採録。',
  'LLM推論効率化。70Bモデル3倍高速化。EMNLP 2025採録。');

INSERT INTO knowledge_base (twinId, sourceType, title, content, summary)
VALUES (102, 'manual', '産学連携プロジェクト実績',
  '過去5年で10件の産学連携プロジェクトを実施。代表例: 自動車メーカーとの自動運転AI共同研究（3年、1.5億円）、金融機関との不正検知AI開発（2年、8000万円）、医療機関との診断支援AI（1年、3000万円）。いずれも論文化＋特許取得＋プロダクト化まで一貫して推進。',
  '産学連携10件。自動車・金融・医療分野。総額3億円以上。');

-- =============== Friendships (all 3 demo users are friends with each other) ===============
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (100, 101, 'accepted');
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (100, 102, 'accepted');
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (101, 102, 'accepted');

-- Also befriend NPC guides
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (15, 100, 'accepted');
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (16, 100, 'accepted');
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (15, 101, 'accepted');
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (16, 101, 'accepted');
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (15, 102, 'accepted');
INSERT OR IGNORE INTO friendships (userId, friendId, status) VALUES (16, 102, 'accepted');

-- =============== Trust Scores ===============
INSERT OR REPLACE INTO trust_scores (userId, score, rank) VALUES (100, 72, 'gold');
INSERT OR REPLACE INTO trust_scores (userId, score, rank) VALUES (101, 65, 'gold');
INSERT OR REPLACE INTO trust_scores (userId, score, rank) VALUES (102, 48, 'silver');

-- Trust history
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'profile_field_displayName', 2, 2, '表示名を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'profile_field_bio', 3, 5, '自己紹介を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'profile_field_company', 2, 7, '会社名を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'profile_field_industry', 2, 9, '業種を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'profile_field_position', 2, 11, '役職を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'profile_field_skills', 3, 14, 'スキルを設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'profile_field_expertise', 3, 17, '専門分野を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'profile_field_experience', 3, 20, '経験を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'matching_complete', 5, 25, 'マッチング完了: AIビジネス協業');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'matching_complete', 5, 30, 'マッチング完了: デザイン×テクノロジー');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'matching_complete', 5, 35, 'マッチング完了: 研究開発パートナーシップ');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'knowledge_add', 3, 38, 'ナレッジベースにエントリ追加');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'knowledge_add', 3, 41, 'ナレッジベースにエントリ追加');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (100, 'knowledge_add', 3, 44, 'ナレッジベースにエントリ追加');

INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (101, 'profile_field_displayName', 2, 2, '表示名を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (101, 'profile_field_bio', 3, 5, '自己紹介を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (101, 'profile_field_company', 2, 7, '会社名を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (101, 'profile_field_skills', 3, 10, 'スキルを設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (101, 'matching_complete', 5, 15, 'マッチング完了: デザイン×テクノロジー');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (101, 'matching_complete', 5, 20, 'マッチング完了: UXリサーチ協業');

INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (102, 'profile_field_displayName', 2, 2, '表示名を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (102, 'profile_field_bio', 3, 5, '自己紹介を設定しました');
INSERT INTO trust_score_history (userId, action, delta, scoreAfter, description) VALUES (102, 'matching_complete', 5, 10, 'マッチング完了: AI技術移転');

-- =============== Points ===============
INSERT OR REPLACE INTO user_points (userId, balance, totalEarned, totalSpent, totalExpired) VALUES (100, 850, 1200, 350, 0);
INSERT OR REPLACE INTO user_points (userId, balance, totalEarned, totalSpent, totalExpired) VALUES (101, 420, 600, 180, 0);
INSERT OR REPLACE INTO user_points (userId, balance, totalEarned, totalSpent, totalExpired) VALUES (102, 150, 200, 50, 0);

-- =============== Pre-built Matching Sessions & Results ===============
-- Session 1: 田中太郎 × 佐藤花子 (テーマ: AI×デザインの融合)
INSERT INTO matching_sessions (id, initiatorUserId, twin1Id, twin2Id, theme, status, completedAt)
VALUES (200, 100, 100, 101, 'AI×デザインの融合による新しいUX体験の創出', 'completed', datetime('now', '-3 days'));

INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES
(200, 100, '佐藤さん、はじめまして。NextAIの田中です。AIとデザインの融合は非常に興味深いテーマですね。弊社ではLLMオーケストレーションプラットフォームを提供していますが、UIの質がプロダクトの成功を大きく左右することを痛感しています。具体的にはAIの出力をいかに「使いやすく」「信頼できる」形でユーザーに提示するか、この部分でデザインの力が必要だと考えています。', 0, 'demo-seed', 'v1'),
(200, 101, 'はじめまして、田中さん。Bloom Designの佐藤です。まさにそのポイントが重要ですよね。AI搭載プロダクトのUX設計では「AIの不確実性をどう伝えるか」が最大の課題です。弊社の実績では、Fintech企業様のAI審査結果の表示を「確信度ゲージ」というビジュアルで再設計したところ、ユーザーの理解度が60%向上しました。御社のプラットフォームでも同様のアプローチが有効ではないでしょうか。', 1, 'demo-seed', 'v1'),
(200, 100, '確信度ゲージは素晴らしいアプローチですね。弊社のクライアント企業からも「AIの判断根拠が分かりにくい」というフィードバックが多く、Explainable AIのUI化は急務です。具体的にご提案いただけるとしたら、LLMの回答に対する信頼度スコアや、参照元ドキュメントの可視化をどう設計しますか？', 2, 'demo-seed', 'v1'),
(200, 101, '3つのレイヤーでの設計を提案します。①メインアウトプット：AIの回答をカード形式で表示し、信頼度を色（緑→黄→赤）で直感的に伝える。②エビデンスパネル：サイドバーに参照ドキュメントのハイライトリンクを表示。③フィードバックループ：ユーザーが「正確」「不正確」をワンクリックで評価でき、次回以降のAI精度向上に反映。この設計で、弊社の別プロジェクトではユーザー満足度が40%改善しました。', 3, 'demo-seed', 'v1'),
(200, 100, '非常に実践的なご提案ですね。特にフィードバックループの仕組みは弊社のRAGパイプラインと直接連携できそうです。まずはPoCとして1社のクライアント企業で試して、効果を数字で検証しませんか？弊社からはAPIとデータを提供し、Bloom Design様にはUI設計とユーザーテスト設計をお願いする形で。3ヶ月のスプリントでMVPを作れると思います。', 4, 'demo-seed', 'v1');

INSERT INTO matching_results (sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, nextSteps)
VALUES (200, 82,
  '{"skillMatch":{"score":17,"reason":"AI技術力とUXデザイン力が高いレベルで補完的。LLM×UIの具体的なユースケースが明確。"},"valueAlignment":{"score":16,"reason":"データドリブンな意思決定とユーザー中心設計という共通の価値観。エビデンスベースのアプローチを双方が重視。"},"communicationStyle":{"score":17,"reason":"論理的かつ具体的な議論ができている。数字を交えた提案が双方から出ており、建設的。"},"businessGoalFit":{"score":16,"reason":"エンタープライズAIのUX改善という明確な共通目標。既存クライアント企業でのPoCという具体的なアクションが合意。"},"complementaryStrengths":{"score":16,"reason":"技術開発力×デザイン力の組み合わせは市場で希少。Explainable AIのUI設計という具体的な協業領域が見つかった。"}}',
  'AI技術とデザイン力の高度な融合により、エンタープライズAI市場で差別化されたUXソリューションを共同開発できる可能性が高い。',
  '["技術力×デザイン力の希少な組み合わせ","既存クライアント企業でのPoC実施が可能","Explainable AI UIという明確な協業テーマ","双方にユーザーリサーチの実績あり","3ヶ月MVPという具体的なタイムライン"]',
  '["報酬体系・収益配分の合意が必要","複数クライアント企業との調整コスト"]',
  '["1社でのPoC（3ヶ月）→ 効果測定 → 横展開","月次デザインレビュー会の設定","共同でのケーススタディ発表（カンファレンス登壇）"]',
  'AI×デザインの融合について非常に建設的な議論が行われました。田中氏のLLMオーケストレーション技術と佐藤氏のUXデザイン実績が高い補完性を持ち、特にExplainable AIのUI設計という具体的な協業テーマが見つかりました。3ヶ月のPoCスプリントという現実的なアクションプランも合意に至っており、協業実現の可能性は高いと評価します。',
  '## 詳細分析\n\n### 補完性\n田中氏（NextAI）の強み: LLMオーケストレーション、RAGパイプライン、エンタープライズAI\n佐藤氏（Bloom Design）の強み: UXデザイン、ユーザーリサーチ、ビジュアルコミュニケーション\n\n### 市場機会\nExplainable AIのUI設計は急成長市場。EU AI Actの施行により、AIの判断根拠の可視化が法的要件に。',
  '1. 初回ミーティング設定（来週中）\n2. NDA締結とPoC対象クライアント選定\n3. デザインスプリント開始（翌月初）');

-- Session 2: 田中太郎 × 鈴木一郎 (テーマ: LLM研究の事業化)
INSERT INTO matching_sessions (id, initiatorUserId, twin1Id, twin2Id, theme, status, completedAt)
VALUES (201, 100, 100, 102, 'LLM研究の事業化と技術移転戦略', 'completed', datetime('now', '-1 day'));

INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES
(201, 100, '鈴木先生、はじめまして。NextAIの田中です。LLMの推論効率化に関するEMNLP論文を拝読しました。70Bモデルの3倍高速化は驚異的な成果ですね。弊社のエンタープライズAIプラットフォームでは推論コストが最大のボトルネックになっています。先生の研究成果を実プロダクトに組み込む可能性について議論させてください。', 0, 'demo-seed', 'v1'),
(201, 102, 'はじめまして、田中さん。論文を読んでいただきありがとうございます。推論効率化の研究は理論的には成功していますが、実際のプロダクション環境での検証はまだ限定的です。御社のようなリアルワールドの大規模環境でテストできれば、研究にとっても大きな価値があります。具体的にはどのような規模のモデルを運用されていますか？', 1, 'demo-seed', 'v1'),
(201, 100, '現在はGPT-4クラスの大規模モデルと、7-13Bの小規模モデルを用途に応じて使い分けています。月間の推論コストが約1000万円で、クライアント数の増加に伴い急増中です。特に金融系クライアントのリアルタイム分析では、レイテンシーが大きな課題です。先生の量子化手法を適用した場合、品質を維持しながらどの程度のコスト削減が見込めますか？', 2, 'demo-seed', 'v1'),
(201, 102, '弊社の量子化手法（INT4 + 適応的蒸留の組み合わせ）を13Bモデルに適用した場合、推論速度は約2.8倍、メモリ使用量は60%削減できます。品質劣化はベンチマーク上5%以内です。御社のユースケースでは月間コストを40-50%削減できる可能性があります。ただし、金融ドメイン特有の精度要件があるので、ファインチューニングとの組み合わせが重要です。共同研究としてNEDOの補助金（ポスト5G）申請も視野に入れられますか？', 3, 'demo-seed', 'v1'),
(201, 100, '月間コスト40-50%削減は非常にインパクトがありますね。NEDO補助金は素晴らしいアイデアです。弊社の事業計画にもフィットします。まずは共同研究契約を締結して、1つの金融系クライアントで2ヶ月のベンチマークテストを実施しませんか？弊社からは推論基盤とデータ環境を提供し、先生のチームに最適化実装をお願いする形で。成果は共同論文としてまとめましょう。', 4, 'demo-seed', 'v1');

INSERT INTO matching_results (sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, nextSteps)
VALUES (201, 88,
  '{"skillMatch":{"score":19,"reason":"LLM推論効率化の最先端研究と、エンタープライズ級の大規模運用環境という理想的な組み合わせ。"},"valueAlignment":{"score":17,"reason":"データドリブンな検証と実証重視のアプローチが一致。学術的厳密性とビジネス実装の両立を目指す姿勢。"},"communicationStyle":{"score":17,"reason":"技術的に深い議論がスムーズに行えている。数字ベースの具体的な議論で合意形成が早い。"},"businessGoalFit":{"score":18,"reason":"推論コスト削減という明確なROI。NEDO補助金という公的資金の活用構想。共同論文という学術的成果も見込める。"},"complementaryStrengths":{"score":17,"reason":"研究チームの理論的深さ×プロダクションチームの実装力。金融ドメインの実データでの検証が可能。"}}',
  'LLM推論効率化研究の事業化において、研究力とプロダクション環境の理想的な組み合わせ。月間1000万円のコスト40-50%削減という明確なROIが見込める。',
  '["推論コスト40-50%削減の明確なROI","NEDO補助金活用の可能性","共同論文による学術的成果","金融系実データでの検証環境","産学連携の豊富な実績（鈴木側）"]',
  '["知的財産権の帰属整理が必要","金融データの秘密保持契約","研究スケジュールとビジネスタイムラインの調整"]',
  '["共同研究契約の締結（1ヶ月以内）","金融系クライアント1社での2ヶ月ベンチマーク","NEDO ポスト5G補助金の申請準備","共同論文のターゲット会議選定"]',
  'LLM推論効率化という具体的な技術テーマで非常に高い補完性が確認されました。鈴木氏の最先端研究成果（70Bモデル3倍高速化）を田中氏のエンタープライズ環境で実証するという明確な協業モデルが構築でき、月間推論コスト40-50%削減という定量的なROIも見込めます。NEDO補助金活用と共同論文という追加価値もあり、総合的に非常に高い協業ポテンシャルを持つペアです。',
  '## 詳細分析\n\n### 技術シナジー\n量子化（INT4）+ 適応的蒸留 → 13Bモデルで2.8倍高速化、メモリ60%削減\n\n### 財務インパクト\n月間推論コスト1000万円 × 40%削減 = 年間4800万円のコスト削減\n\n### 学術成果\nEMNLP/ACL級の国際会議での共同論文発表',
  '1. NDA締結・共同研究契約（2週間以内）\n2. テスト環境構築・ベンチマーク設計（1ヶ月）\n3. 実証実験開始（2ヶ月目〜）');

-- Session 3: 佐藤花子 × 鈴木一郎 (テーマ: AIプロダクトのUXリサーチ)
INSERT INTO matching_sessions (id, initiatorUserId, twin1Id, twin2Id, theme, status, completedAt)
VALUES (202, 101, 101, 102, 'AI研究者とデザイナーの協業：ユーザー中心のAIプロダクト開発', 'completed', datetime('now', '-2 days'));

INSERT INTO matching_dialogues (sessionId, speakerTwinId, content, turnNumber, aiProvider, aiModel) VALUES
(202, 101, '鈴木先生、はじめまして。Bloom Designの佐藤です。先生の自然言語処理研究に大変興味があります。実は最近、AI搭載プロダクトのUXリサーチで「AIの説明可能性をいかにデザインするか」が大きなテーマになっています。研究者の視点から、ユーザーにAIの判断根拠を伝える際のベストプラクティスを伺えますか？', 0, 'demo-seed', 'v1'),
(202, 102, 'はじめまして、佐藤さん。非常に重要なテーマですね。研究者としては、Attention Visualizationやfeature importanceなど技術的な説明手法は多数ありますが、一般ユーザーへの伝え方となると専門外で苦労しています。弊社の診断支援AIプロジェクトでも、医師は「なぜこの診断なのか」を知りたがりますが、数式では伝わりません。佐藤さんのデザインの力でこの翻訳問題を解決できると大きいです。', 1, 'demo-seed', 'v1'),
(202, 101, 'まさに「翻訳問題」ですね。弊社では「説明のレイヤリング」というアプローチを取っています。第1層：結果の要約（一行テキスト）、第2層：主要な根拠3つ（ビジュアルカード）、第3層：詳細な技術的説明（展開可能パネル）。ユーザーが必要に応じて深掘りできる設計です。医療AIであれば、第1層で「推奨診断：〇〇」、第2層で「参考にした症状TOP3」、第3層で「類似症例との比較データ」という構造になります。', 2, 'demo-seed', 'v1'),
(202, 102, 'レイヤリングの考え方は論文の構造（Abstract → Introduction → Detail）と似ていて、研究者にも直感的です。実は来月から始まる医療AI共同研究で、UIの設計パートナーを探していたところでした。このプロジェクトで佐藤さんにUI/UXデザインを担当していただくことは可能でしょうか？予算は3000万円規模で、期間は1年間です。', 3, 'demo-seed', 'v1'),
(202, 101, '素晴らしいお話ですね。ぜひ参加させてください。医療AIのUXデザインは弊社にとっても新しいチャレンジで、非常にやりがいがあります。まずは医師へのユーザーリサーチから始めて、ペルソナ設計→プロトタイピング→ユーザーテストのサイクルを回しましょう。弊社のデザインシンキングワークショップを先生の研究チーム向けに開催して、ユーザー視点の共有から始めるのはいかがでしょうか？', 4, 'demo-seed', 'v1');

INSERT INTO matching_results (sessionId, compatibilityScore, scoreBreakdown, collaborationPotential, strengths, challenges, recommendations, summary, detailedAnalysis, nextSteps)
VALUES (202, 79,
  '{"skillMatch":{"score":16,"reason":"AI研究の技術力とUXデザイン力。医療AIという具体的なドメインでの接点が明確。"},"valueAlignment":{"score":16,"reason":"ユーザー中心の設計思想と学術的厳密性の両立。エビデンスベースのアプローチが共通。"},"communicationStyle":{"score":15,"reason":"異分野間の対話がスムーズ。翻訳問題の比喩など、互いの専門用語を理解しやすく言い換える能力が高い。"},"businessGoalFit":{"score":16,"reason":"医療AI共同研究という具体的なプロジェクト（3000万円/1年）が即座に合意。"},"complementaryStrengths":{"score":16,"reason":"研究チームの技術力×デザインチームのユーザーリサーチ力。説明可能AIのUI設計という独自の価値提案。"}}',
  '医療AIプロジェクトでの即座の協業合意。AI研究者とデザイナーの協業モデルとして、他分野への横展開も期待できる。',
  '["医療AI共同研究（3000万円）での即座の協業合意","説明のレイヤリングという具体的な設計手法","デザインシンキングWS開催による研究チームのUX意識向上","異分野コラボレーションの好例"]',
  '["医療ドメインの専門知識習得が必要（佐藤側）","研究スケジュールとデザインプロセスの調整"]',
  '["デザインシンキングWS開催（初月）","医師へのユーザーリサーチ（1-2ヶ月目）","プロトタイプ制作・テスト（3-6ヶ月目）"]',
  'AI研究者とデザイナーの異分野コラボレーションが見事に成立しました。「AI説明可能性のUI設計」という共通課題を起点に、医療AI共同研究（3000万円/1年）という具体的なプロジェクトでの協業が即座に合意されました。',
  '## 詳細分析\n\n### 協業モデル\n鈴木（AI技術・ドメイン知識）× 佐藤（UXデザイン・ユーザーリサーチ）\n\n### 期待成果\nユーザビリティの高い医療AI UIの実現、共同論文発表',
  '1. デザインシンキングWS（来月）\n2. 医師インタビュー設計・実施\n3. ペルソナ・ジャーニーマップ作成');

-- =============== Twin Growth Status ===============
INSERT OR REPLACE INTO twin_growth_status (twinId, userId, level, experience, totalConversations, totalKnowledgeEntries, consecutiveLoginDays)
VALUES (100, 100, 8, 2400, 45, 3, 12);

INSERT OR REPLACE INTO twin_growth_status (twinId, userId, level, experience, totalConversations, totalKnowledgeEntries, consecutiveLoginDays)
VALUES (101, 101, 5, 1200, 28, 2, 7);

INSERT OR REPLACE INTO twin_growth_status (twinId, userId, level, experience, totalConversations, totalKnowledgeEntries, consecutiveLoginDays)
VALUES (102, 102, 3, 600, 15, 2, 3);

-- =============== Notifications ===============
INSERT INTO notifications (userId, type, title, message, isRead) VALUES (100, 'matching', 'マッチング完了', '佐藤花子さんとのマッチングが完了しました。相性スコア: 82点', 1);
INSERT INTO notifications (userId, type, title, message, isRead) VALUES (100, 'matching', 'マッチング完了', '鈴木一郎さんとのマッチングが完了しました。相性スコア: 88点', 1);
INSERT INTO notifications (userId, type, title, message, isRead) VALUES (100, 'friend', '友達申請承認', '佐藤花子さんが友達リクエストを承認しました', 1);
INSERT INTO notifications (userId, type, title, message, isRead) VALUES (100, 'system', '信頼度アップ', '信頼度スコアがGoldランクに到達しました！', 0);
INSERT INTO notifications (userId, type, title, message, isRead) VALUES (101, 'matching', 'マッチング完了', '鈴木一郎さんとのマッチングが完了しました。相性スコア: 79点', 0);
