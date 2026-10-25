package printer

import (
	"context"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"sync"
)

const MaxPDFOutputBytes = 64 * 1024 * 1024

type OutputEvidence struct {
	OutputMedium string `json:"output_medium"`
	ArtifactID   string `json:"artifact_id"`
	SHA256       string `json:"sha256"`
	PageCount    int    `json:"page_count"`
	Bytes        int64  `json:"bytes"`
}

var outputArtifactIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func validOutputEvidence(e OutputEvidence) bool {
	return ValidateOutputEvidence(&e) == nil
}

// ValidateOutputEvidence is the shared native boundary for durable file-result
// evidence. Filesystem paths are deliberately absent from this public record.
func ValidateOutputEvidence(e *OutputEvidence) error {
	if e == nil {
		return fmt.Errorf("PDF output evidence is required")
	}
	_, err := hex.DecodeString(e.SHA256)
	if e.OutputMedium != "file" || !outputArtifactIDPattern.MatchString(e.ArtifactID) || len(e.SHA256) != 64 || e.SHA256 != strings.ToLower(e.SHA256) || err != nil || e.PageCount < 1 || e.PageCount > 10000 || e.Bytes < 1 || e.Bytes > MaxPDFOutputBytes {
		return fmt.Errorf("PDF output evidence must contain a file artifact identifier, SHA-256, page count, and bounded byte count")
	}
	return nil
}

type outputEvidenceContextKey struct{}

// OutputEvidenceScope belongs to one invocation and closes with its terminal
// outcome. A worker cannot transfer a later file result to the next invocation.
type OutputEvidenceScope struct {
	mu     sync.Mutex
	value  *OutputEvidence
	closed bool
}

func WithOutputEvidence(ctx context.Context) (context.Context, *OutputEvidenceScope) {
	scope := &OutputEvidenceScope{}
	return context.WithValue(ctx, outputEvidenceContextKey{}, scope), scope
}

func (s *OutputEvidenceScope) Snapshot() *OutputEvidence {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.value == nil {
		return nil
	}
	copy := *s.value
	return &copy
}

func (s *OutputEvidenceScope) Close() *OutputEvidence {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.value == nil {
		return nil
	}
	copy := *s.value
	return &copy
}

func recordOutputEvidence(ctx context.Context, value OutputEvidence) bool {
	if !validOutputEvidence(value) {
		return false
	}
	scope, _ := ctx.Value(outputEvidenceContextKey{}).(*OutputEvidenceScope)
	if scope == nil {
		return true
	}
	scope.mu.Lock()
	defer scope.mu.Unlock()
	if scope.closed || scope.value != nil {
		return false
	}
	copy := value
	scope.value = &copy
	return true
}
