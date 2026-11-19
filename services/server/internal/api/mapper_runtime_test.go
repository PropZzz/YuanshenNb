package api

import (
	"github.com/shixu-app/server/internal/engine"
	"testing"
)

func TestEnergyMapperNormalizesFocusShieldSourcesToContract(t *testing.T) {
	input := engine.EnergyComputeOutput{FocusShields: []engine.FocusShieldWindow{{Source: "energy_prediction"}, {Source: "preferred_focus_window"}, {Source: "auto_peak"}, {Source: "preferred_window"}}}
	out := FromEngineEnergyOutput(input)
	if out.FocusShields[0].Source != FocusShieldAutoPeak || out.FocusShields[1].Source != FocusShieldPreferredWindow || out.FocusShields[2].Source != FocusShieldAutoPeak || out.FocusShields[3].Source != FocusShieldPreferredWindow {
		t.Fatal("engine source labels escaped the HTTP enum contract")
	}
}
