import mysql from 'mysql2/promise';
import { nanoid } from 'nanoid';

// テストユーザーと分身AIのデータ
const testUsers = [
  {
    name: "田中太郎",
    personality: "論理的で分析力が高い。データに基づいた判断を好み、感情よりも事実を重視する。新しい技術やアイデアに対してオープンで、常に学び続ける姿勢を持つ。",
    rawInput: "私はIT企業でエンジニアとして10年働いています。プログラミングが好きで、特にAIと機械学習に興味があります。休日は読書やプログラミングの勉強をしています。論理的に考えることが得意で、問題解決が好きです。チームワークも大切にしていますが、一人で集中して作業する時間も必要です。",
    bigFiveTraits: { openness: 85, conscientiousness: 80, extraversion: 45, agreeableness: 65, neuroticism: 30 },
    mbtiType: { type: "INTJ", dimensions: { EI: -60, SN: 70, TF: -50, JP: -40 }, description: "戦略家", strengths: ["論理的思考", "計画性"], weaknesses: ["感情表現"], compatibleTypes: ["ENFP", "ENTP"], careerSuggestions: ["エンジニア", "研究者"] },
    judgmentThresholds: { goodEvil: 70, likesDislike: 50, profitLoss: 60, interest: 55, pleasurePain: 40, difficulty: 30, possibility: 65, comfort: 45, rightWrong: 80 },
    tags: ["エンジニア", "AI", "論理的"]
  },
  {
    name: "佐藤花子",
    personality: "共感力が高く、人の気持ちを理解することが得意。創造的で芸術的なセンスがあり、美しいものに惹かれる。人との繋がりを大切にし、チームの調和を重視する。",
    rawInput: "デザイナーとして働いています。ユーザー体験を大切にしたデザインを心がけています。人と話すことが好きで、クライアントとのコミュニケーションも得意です。休日は美術館に行ったり、カフェでスケッチをしたりしています。新しいアイデアを考えるのが好きで、常にインスピレーションを求めています。",
    bigFiveTraits: { openness: 90, conscientiousness: 60, extraversion: 75, agreeableness: 85, neuroticism: 45 },
    mbtiType: { type: "ENFP", dimensions: { EI: 60, SN: 70, TF: 50, JP: 60 }, description: "広報運動家", strengths: ["創造性", "共感力"], weaknesses: ["計画性"], compatibleTypes: ["INTJ", "INFJ"], careerSuggestions: ["デザイナー", "マーケター"] },
    judgmentThresholds: { goodEvil: 80, likesDislike: 70, profitLoss: 40, interest: 50, pleasurePain: 60, difficulty: 50, possibility: 45, comfort: 65, rightWrong: 55 },
    tags: ["デザイナー", "クリエイティブ", "共感力"]
  },
  {
    name: "鈴木一郎",
    personality: "リーダーシップがあり、決断力が高い。目標達成に向けて粘り強く取り組む。競争心が強く、常に成長を求める。直接的なコミュニケーションを好む。",
    rawInput: "営業部長として15年のキャリアがあります。チームを率いて目標を達成することにやりがいを感じます。数字で結果を出すことを重視しています。休日はゴルフや筋トレをしています。新しいビジネスチャンスを見つけることが得意で、人脈を広げることも好きです。",
    bigFiveTraits: { openness: 55, conscientiousness: 85, extraversion: 90, agreeableness: 50, neuroticism: 35 },
    mbtiType: { type: "ENTJ", dimensions: { EI: 80, SN: -30, TF: -60, JP: -70 }, description: "指揮官", strengths: ["リーダーシップ", "決断力"], weaknesses: ["共感力"], compatibleTypes: ["INTP", "ISTP"], careerSuggestions: ["経営者", "営業"] },
    judgmentThresholds: { goodEvil: 60, likesDislike: 45, profitLoss: 85, interest: 80, pleasurePain: 35, difficulty: 25, possibility: 70, comfort: 40, rightWrong: 65 },
    tags: ["営業", "リーダー", "目標達成"]
  },
  {
    name: "高橋美咲",
    personality: "細部に注意を払い、完璧主義的な傾向がある。責任感が強く、約束を必ず守る。慎重で計画的に物事を進める。安定を好み、リスクを避ける傾向がある。",
    rawInput: "経理部で10年働いています。数字を扱う仕事が好きで、正確さを大切にしています。計画を立てて着実に実行することが得意です。休日は家で料理をしたり、読書をしたりしています。新しいことを始めるときは十分に調べてから行動します。",
    bigFiveTraits: { openness: 40, conscientiousness: 95, extraversion: 35, agreeableness: 70, neuroticism: 55 },
    mbtiType: { type: "ISTJ", dimensions: { EI: -70, SN: -60, TF: -40, JP: -80 }, description: "管理者", strengths: ["正確さ", "責任感"], weaknesses: ["柔軟性"], compatibleTypes: ["ESTP", "ESFP"], careerSuggestions: ["経理", "監査"] },
    judgmentThresholds: { goodEvil: 85, likesDislike: 55, profitLoss: 70, interest: 60, pleasurePain: 50, difficulty: 60, possibility: 80, comfort: 55, rightWrong: 90 },
    tags: ["経理", "正確", "計画的"]
  },
  {
    name: "伊藤健太",
    personality: "好奇心旺盛で、新しいことに挑戦するのが好き。柔軟な思考を持ち、変化を楽しむ。楽観的で、困難な状況でも前向きに考える。自由を大切にする。",
    rawInput: "スタートアップで働いています。新しいビジネスモデルを考えることが好きです。失敗を恐れずに挑戦することを大切にしています。休日は旅行やアウトドア活動を楽しんでいます。多様な人と出会い、新しい視点を得ることが好きです。",
    bigFiveTraits: { openness: 95, conscientiousness: 50, extraversion: 80, agreeableness: 60, neuroticism: 25 },
    mbtiType: { type: "ENTP", dimensions: { EI: 70, SN: 80, TF: -30, JP: 70 }, description: "討論者", strengths: ["創造性", "適応力"], weaknesses: ["継続性"], compatibleTypes: ["INTJ", "INFJ"], careerSuggestions: ["起業家", "コンサルタント"] },
    judgmentThresholds: { goodEvil: 50, likesDislike: 60, profitLoss: 55, interest: 65, pleasurePain: 70, difficulty: 20, possibility: 35, comfort: 50, rightWrong: 45 },
    tags: ["スタートアップ", "挑戦", "柔軟"]
  },
  {
    name: "渡辺愛",
    personality: "思いやりがあり、他者のために尽くすことに喜びを感じる。穏やかで、争いを避ける傾向がある。直感的で、感情を大切にする。伝統や家族を重視する。",
    rawInput: "看護師として病院で働いています。患者さんの笑顔を見ることがやりがいです。チームワークを大切にし、同僚との協力を重視しています。休日は家族と過ごしたり、ボランティア活動に参加したりしています。人の役に立つことが好きです。",
    bigFiveTraits: { openness: 50, conscientiousness: 75, extraversion: 55, agreeableness: 95, neuroticism: 50 },
    mbtiType: { type: "ISFJ", dimensions: { EI: -50, SN: -40, TF: 60, JP: -60 }, description: "擁護者", strengths: ["思いやり", "忍耐力"], weaknesses: ["自己主張"], compatibleTypes: ["ESTP", "ESFP"], careerSuggestions: ["看護師", "教師"] },
    judgmentThresholds: { goodEvil: 90, likesDislike: 65, profitLoss: 35, interest: 40, pleasurePain: 55, difficulty: 55, possibility: 60, comfort: 70, rightWrong: 75 },
    tags: ["看護師", "思いやり", "チームワーク"]
  },
  {
    name: "山本大輔",
    personality: "独立心が強く、自分の道を進む。深く考えることが好きで、哲学的な議論を楽しむ。内省的で、自己成長を重視する。少数の深い関係を好む。",
    rawInput: "フリーランスのライターとして活動しています。自分のペースで仕事ができることを大切にしています。深いテーマについて書くことが好きです。休日は一人で散歩したり、映画を見たりしています。表面的な付き合いよりも、深い関係を築くことを好みます。",
    bigFiveTraits: { openness: 85, conscientiousness: 65, extraversion: 25, agreeableness: 55, neuroticism: 45 },
    mbtiType: { type: "INFP", dimensions: { EI: -80, SN: 60, TF: 70, JP: 50 }, description: "仲介者", strengths: ["創造性", "共感力"], weaknesses: ["現実的判断"], compatibleTypes: ["ENFJ", "ENTJ"], careerSuggestions: ["ライター", "カウンセラー"] },
    judgmentThresholds: { goodEvil: 75, likesDislike: 80, profitLoss: 30, interest: 35, pleasurePain: 65, difficulty: 45, possibility: 40, comfort: 75, rightWrong: 60 },
    tags: ["ライター", "独立", "内省的"]
  },
  {
    name: "中村さくら",
    personality: "社交的で、人を楽しませることが好き。エネルギッシュで、行動力がある。今この瞬間を大切にし、楽しむことを重視する。実践的で、手を動かすことが好き。",
    rawInput: "イベントプランナーとして働いています。人を喜ばせるイベントを企画することにやりがいを感じます。人と会うことが大好きで、パーティーやイベントによく参加します。休日も友達と出かけることが多いです。新しい体験をすることが好きです。",
    bigFiveTraits: { openness: 70, conscientiousness: 55, extraversion: 95, agreeableness: 75, neuroticism: 30 },
    mbtiType: { type: "ESFP", dimensions: { EI: 90, SN: -50, TF: 40, JP: 70 }, description: "エンターテイナー", strengths: ["社交性", "適応力"], weaknesses: ["長期計画"], compatibleTypes: ["ISTJ", "ISFJ"], careerSuggestions: ["イベントプランナー", "営業"] },
    judgmentThresholds: { goodEvil: 55, likesDislike: 75, profitLoss: 45, interest: 55, pleasurePain: 80, difficulty: 60, possibility: 50, comfort: 80, rightWrong: 40 },
    tags: ["イベント", "社交的", "エネルギッシュ"]
  },
  {
    name: "小林誠",
    personality: "分析的で、問題の本質を見抜く力がある。独立した思考を持ち、権威に盲従しない。効率を重視し、無駄を嫌う。知識を深めることに喜びを感じる。",
    rawInput: "データサイエンティストとして働いています。データから洞察を得ることが好きです。効率的な方法を常に探しています。休日はプログラミングの勉強や、技術書を読んでいます。論理的に考えることが得意で、感情的な議論は苦手です。",
    bigFiveTraits: { openness: 80, conscientiousness: 70, extraversion: 30, agreeableness: 45, neuroticism: 40 },
    mbtiType: { type: "INTP", dimensions: { EI: -70, SN: 80, TF: -70, JP: 60 }, description: "論理学者", strengths: ["分析力", "独創性"], weaknesses: ["感情理解"], compatibleTypes: ["ENTJ", "ESTJ"], careerSuggestions: ["データサイエンティスト", "研究者"] },
    judgmentThresholds: { goodEvil: 65, likesDislike: 40, profitLoss: 65, interest: 70, pleasurePain: 45, difficulty: 25, possibility: 55, comfort: 50, rightWrong: 85 },
    tags: ["データサイエンス", "分析", "効率"]
  },
  {
    name: "加藤由美",
    personality: "調和を大切にし、グループの一体感を重視する。忠実で、信頼できる。伝統的な価値観を持ち、安定を好む。実務的で、地に足のついた考え方をする。",
    rawInput: "人事部で働いています。社員が働きやすい環境を作ることを大切にしています。チームの調和を保つことが得意です。休日は家族と過ごしたり、地域のコミュニティ活動に参加したりしています。安定した生活を送ることを大切にしています。",
    bigFiveTraits: { openness: 45, conscientiousness: 80, extraversion: 60, agreeableness: 85, neuroticism: 45 },
    mbtiType: { type: "ESFJ", dimensions: { EI: 50, SN: -50, TF: 60, JP: -60 }, description: "領事官", strengths: ["協調性", "実務能力"], weaknesses: ["変化への適応"], compatibleTypes: ["ISTP", "ISFP"], careerSuggestions: ["人事", "教師"] },
    judgmentThresholds: { goodEvil: 80, likesDislike: 60, profitLoss: 50, interest: 45, pleasurePain: 55, difficulty: 55, possibility: 65, comfort: 65, rightWrong: 70 },
    tags: ["人事", "調和", "チームワーク"]
  }
];

async function seedTestData() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '4000'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bunshin_ai',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined
  });

  console.log('Connected to database');

  try {
    for (let i = 0; i < testUsers.length; i++) {
      const user = testUsers[i];
      const openId = `test_user_${nanoid(16)}`;
      const friendCode = nanoid(8).toUpperCase();
      
      // ユーザーを作成
      const [userResult] = await connection.execute(
        `INSERT INTO users (openId, name, email, loginMethod, role, plan, friendCode, createdAt, updatedAt, lastSignedIn)
         VALUES (?, ?, ?, 'test', 'user', 'free', ?, NOW(), NOW(), NOW())`,
        [openId, user.name, `test${i + 1}@example.com`, friendCode]
      );
      
      const userId = userResult.insertId;
      console.log(`Created user: ${user.name} (ID: ${userId})`);
      
      // 分身AIを作成
      const systemPrompt = `あなたは${user.name}の分身AIです。${user.personality}`;
      
      await connection.execute(
        `INSERT INTO digital_twins (userId, name, description, personality, systemPrompt, rawInput, status, isPublic, publicBio, tags, bigFiveTraits, judgmentThresholds, mbtiType, personalitySimilarity, accuracyScore, trainingIterations, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, 75.00, 70.00, 3, NOW(), NOW())`,
        [
          userId,
          user.name,
          user.personality,
          user.personality,
          systemPrompt,
          user.rawInput,
          user.personality.substring(0, 100),
          JSON.stringify(user.tags),
          JSON.stringify(user.bigFiveTraits),
          JSON.stringify(user.judgmentThresholds),
          JSON.stringify(user.mbtiType)
        ]
      );
      
      console.log(`Created digital twin for: ${user.name}`);
    }
    
    console.log('\n=== Test data seeding completed ===');
    console.log(`Created ${testUsers.length} test users with digital twins`);
    
    // 作成したデータを確認
    const [users] = await connection.execute('SELECT id, name, friendCode FROM users WHERE openId LIKE "test_user_%"');
    console.log('\nCreated test users:');
    users.forEach(u => console.log(`  - ${u.name} (ID: ${u.id}, Friend Code: ${u.friendCode})`));
    
    const [twins] = await connection.execute('SELECT id, name, userId FROM digital_twins WHERE userId IN (SELECT id FROM users WHERE openId LIKE "test_user_%")');
    console.log('\nCreated digital twins:');
    twins.forEach(t => console.log(`  - ${t.name} (Twin ID: ${t.id}, User ID: ${t.userId})`));
    
  } catch (error) {
    console.error('Error seeding data:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

seedTestData().catch(console.error);
