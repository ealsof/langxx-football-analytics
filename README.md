# Football Analytics Lab — v0.1

Fondasi proyek football analytics yang **multi-device** dan memiliki **background automation**. Website tidak perlu dibuka agar scheduler bekerja.

## Yang sudah dibuat
- Dashboard web responsif untuk laptop/HP.
- SQLite database terpusat.
- Scheduler otomatis setiap 15 menit.
- Pipeline: sync data → simpan match → buat prediction → evaluasi hasil.
- Model version table untuk v0.1 dan siap dikembangkan ke v0.2/v1/v2.
- Endpoint health, matches, predictions, evaluations, metrics.
- MOCK_MODE agar bisa dicoba tanpa API token.
- Sportmonks token disiapkan di server-side `.env`, bukan di browser.

## Menjalankan
1. Install Node.js LTS.
2. `npm install`
3. Copy `.env.example` menjadi `.env`.
4. Untuk demo: `MOCK_MODE=true`.
5. `npm start`
6. Buka `http://localhost:3000`.

## Produksi berikutnya
- Sambungkan Sportmonks secara resmi untuk EPL + La Liga.
- Sinkronisasi fixture/team/player/statistics/lineup/injury dan live state.
- Tambah feature engineering form 5/10, home-away, H2H, player availability/load, tactical matchup, dan verified context events.
- Tambah ML training + walk-forward evaluation + calibration.
- Model versioning: model baru hanya promoted jika out-of-sample lebih baik; rollback bila gagal.
- Deploy backend + database + scheduler sebagai service 24/7.
- Auth/multi-user dan audit log.
