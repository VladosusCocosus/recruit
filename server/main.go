// Recruit update server.
//
// Recruit's GitHub repository is private, so the desktop app cannot read its releases
// directly — that would mean shipping a GitHub token inside the app bundle. This service
// is the seam: it holds the token server-side, reads the latest release, and re-publishes
// the release assets over public, unauthenticated URLs.
//
// It stores nothing. Asset downloads are answered with a 302 to GitHub's short-lived
// signed URL, so release bytes never transit this process.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	githubAPI     = "https://api.github.com"
	cacheTTL      = 60 * time.Second
	upstreamLimit = 15 * time.Second
)

type ghAsset struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
	URL         string `json:"url"`
}

type ghRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	Draft       bool      `json:"draft"`
	Prerelease  bool      `json:"prerelease"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []ghAsset `json:"assets"`
}

// Asset is the public shape. GitHub's own asset URL is deliberately not exposed —
// it requires the token, and callers must come back through /updates or /download.
type Asset struct {
	Name string `json:"name"`
	Arch string `json:"arch"`
	Kind string `json:"kind"` // dmg | zip | manifest
	Size int64  `json:"size"`
	URL  string `json:"url"`
}

type LatestResponse struct {
	Version     string    `json:"version"`
	Tag         string    `json:"tag"`
	Notes       string    `json:"notes"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []Asset   `json:"assets"`
}

type server struct {
	repo   string // owner/name
	token  string
	client *http.Client

	mu       sync.Mutex
	cached   *ghRelease
	cachedAt time.Time
}

func main() {
	repo := env("GITHUB_REPO", "")
	token := env("GITHUB_TOKEN", "")
	port := env("PORT", "8080")

	if repo == "" || token == "" {
		slog.Error("GITHUB_REPO and GITHUB_TOKEN are both required")
		os.Exit(1)
	}

	s := &server{
		repo:   repo,
		token:  token,
		client: &http.Client{Timeout: upstreamLimit},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /api/latest", s.handleLatest)
	mux.HandleFunc("GET /download/latest", s.handleDownload)
	mux.HandleFunc("GET /updates/darwin/{arch}/{file}", s.handleUpdateFile)

	slog.Info("listening", "port", port, "repo", repo)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           logging(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

/* ── handlers ─────────────────────────────────────────────────────────────── */

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
// handleLatest backs the download landing page and the app's update check.
func (s *server) handleLatest(w http.ResponseWriter, r *http.Request) {
	rel, err := s.latest(r.Context())
	if err != nil {
		upstreamError(w, err)
		return
	}

	base := publicBase(r)
	out := LatestResponse{
		Version:     strings.TrimPrefix(rel.TagName, "v"),
		Tag:         rel.TagName,
		Notes:       rel.Body,
		PublishedAt: rel.PublishedAt,
		Assets:      make([]Asset, 0, len(rel.Assets)),
	}
	for _, a := range rel.Assets {
		kind := kindOf(a.Name)
		if kind == "" {
			continue
		}
		out.Assets = append(out.Assets, Asset{
			Name: a.Name,
			Arch: archOf(a.Name),
			Kind: kind,
			Size: a.Size,
			URL:  base + "/updates/darwin/" + archOf(a.Name) + "/" + a.Name,
		})
	}

	// Short cache: the landing page may be hit hard, releases change rarely.
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, out)
}

// handleDownload is the stable link a landing page button can point at forever.
func (s *server) handleDownload(w http.ResponseWriter, r *http.Request) {
	arch := r.URL.Query().Get("arch")
	if arch == "" {
		arch = "arm64"
	}
	if arch != "arm64" && arch != "x64" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "arch must be arm64 or x64"})
		return
	}

	rel, err := s.latest(r.Context())
	if err != nil {
		upstreamError(w, err)
		return
	}
	for _, a := range rel.Assets {
		if kindOf(a.Name) == "dmg" && archOf(a.Name) == arch {
			s.redirectToAsset(w, r, a)
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]string{
		"error": fmt.Sprintf("no dmg for arch %q in release %s", arch, rel.TagName),
	})
}

// handleUpdateFile serves the electron-updater feed. latest-mac.yml is streamed inline
// because the updater parses it; binaries are redirected so bytes skip this process.
//
// The feed is per-arch on purpose. electron-builder emits a single latest-mac.yml when it
// builds several architectures, and the last arch to build wins — so a shared feed offers
// Intel users an arm64 archive. The release workflow builds each arch separately and
// uploads latest-mac-arm64.yml / latest-mac-x64.yml; this maps the canonical name onto the
// right one.
func (s *server) handleUpdateFile(w http.ResponseWriter, r *http.Request) {
	arch := r.PathValue("arch")
	if arch != "arm64" && arch != "x64" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "arch must be arm64 or x64"})
		return
	}

	name := r.PathValue("file")
	if strings.Contains(name, "/") || strings.Contains(name, "..") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad file name"})
		return
	}
	if name == "latest-mac.yml" {
		name = "latest-mac-" + arch + ".yml"
	}

	rel, err := s.latest(r.Context())
	if err != nil {
		upstreamError(w, err)
		return
	}
	for _, a := range rel.Assets {
		if a.Name != name {
			continue
		}
		if strings.HasSuffix(name, ".yml") {
			s.streamAsset(w, r, a)
		} else {
			s.redirectToAsset(w, r, a)
		}
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "asset not found in latest release"})
}

/* ── github ───────────────────────────────────────────────────────────────── */

func (s *server) latest(ctx interface{ Done() <-chan struct{} }) (*ghRelease, error) {
	s.mu.Lock()
	if s.cached != nil && time.Since(s.cachedAt) < cacheTTL {
		rel := s.cached
		s.mu.Unlock()
		return rel, nil
	}
	s.mu.Unlock()

	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/repos/%s/releases/latest", githubAPI, s.repo), nil)
	if err != nil {
		return nil, err
	}
	s.auth(req)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("github returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.cached, s.cachedAt = &rel, time.Now()
	s.mu.Unlock()
	return &rel, nil
}

// redirectToAsset asks GitHub for the asset and hands the caller the signed URL it
// answers with, instead of proxying the body. GitHub replies 302 to a temporary S3 URL;
// the client follows it directly.
func (s *server) redirectToAsset(w http.ResponseWriter, r *http.Request, a ghAsset) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.URL, nil)
	if err != nil {
		upstreamError(w, err)
		return
	}
	s.auth(req)
	req.Header.Set("Accept", "application/octet-stream")

	noFollow := &http.Client{
		Timeout:       upstreamLimit,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := noFollow.Do(req)
	if err != nil {
		upstreamError(w, err)
		return
	}
	defer resp.Body.Close()

	if loc := resp.Header.Get("Location"); loc != "" {
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, loc, http.StatusFound)
		return
	}
	// Some enterprise configurations answer with the body directly.
	copyAsset(w, resp, a)
}

func (s *server) streamAsset(w http.ResponseWriter, r *http.Request, a ghAsset) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.URL, nil)
	if err != nil {
		upstreamError(w, err)
		return
	}
	s.auth(req)
	req.Header.Set("Accept", "application/octet-stream")

	resp, err := s.client.Do(req)
	if err != nil {
		upstreamError(w, err)
		return
	}
	defer resp.Body.Close()
	copyAsset(w, resp, a)
}

func copyAsset(w http.ResponseWriter, resp *http.Response, a ghAsset) {
	if resp.StatusCode != http.StatusOK {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "asset fetch failed"})
		return
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", a.Name))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

func (s *server) auth(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "recruit-updates")
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

func kindOf(name string) string {
	switch {
	case strings.HasSuffix(name, ".dmg"):
		return "dmg"
	case strings.HasSuffix(name, ".zip"):
		return "zip"
	case strings.HasSuffix(name, ".yml"):
		return "manifest"
	default:
		return "" // .blockmap and anything else stays unlisted
	}
}

// electron-builder names Intel artifacts without an arch marker, so absence means x64.
func archOf(name string) string {
	if strings.Contains(name, "arm64") {
		return "arm64"
	}
	return "x64"
}

func publicBase(r *http.Request) string {
	if b := os.Getenv("PUBLIC_BASE_URL"); b != "" {
		return strings.TrimRight(b, "/")
	}
	scheme := "https"
	if r.TLS == nil && !strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "http"
	}
	return scheme + "://" + r.Host
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func upstreamError(w http.ResponseWriter, err error) {
	slog.Error("upstream failure", "err", err)
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream unavailable"})
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "dur", time.Since(start).String())
	})
}
