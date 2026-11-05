MixetteFaustRMS : MultiOutUGen {
    *ar { |left, right, thresholdDb = -20, slopeBelow = 1, slopeAbove = 0.25, attackMs = 10, releaseMs = 100|
        ^this.multiNew('audio', left, right, thresholdDb, slopeBelow, slopeAbove, attackMs, releaseMs)
    }
    init { arg ... theInputs;
        inputs = theInputs;
        ^this.initOutputs(2, rate)
    }
}
