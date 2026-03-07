import './HomePage.css';

interface HomePageProps {
  onNavigate: () => void;
}

function HomePage({ onNavigate }: HomePageProps) {
  return (
    <div className="home-page">
      <div className="home-container">
        <div className="home-content">
          <h1 className="home-title">岸线分析系统</h1>
          <p className="home-subtitle">Bank Line Analysis System</p>

          <button className="start-button" onClick={onNavigate}>
            开始使用
            <span className="button-arrow">→</span>
          </button>

          <div className="home-footer">
            <p>支持 GeoJSON 格式 | 基于 Mapbox GL JS</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
// 新建task