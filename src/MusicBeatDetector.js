const SlidingWindowMax = require('sliding-window-max')
const through = require('through2')
const Fili = require('fili/index')

const FREQ = 44100
const SAMPLES_WINDOW = FREQ * 1.5
const MIN_PEAK_DISTANCE = FREQ / 5
const MAX_INT16 = Math.pow(2, 16) / 2 - 1
const MAX_UINT32 = Math.pow(2, 32) - 1

class MusicBeatDetector {
  constructor (options = {}) {
    this.threshold = MAX_INT16
    this.bpm = [0,0,0]
    this.lastPeakDistance = [MAX_UINT32,MAX_UINT32,MAX_UINT32]
    this.slidingWindowMax = [
      new SlidingWindowMax(SAMPLES_WINDOW, {waitFullRange: false}),
      new SlidingWindowMax(SAMPLES_WINDOW, {waitFullRange: false}),
      new SlidingWindowMax(SAMPLES_WINDOW, {waitFullRange: false})
    ]
    this.pos = [0,0,0]

    this.sensitivity = options.sensitivity || 1
    this.debugFilter = options.debugFilter
    this.plotter = options.plotter
    this.scheduler = options.scheduler
    this.minThreashold = options.minThreashold || MAX_INT16 * 0.05

    this.leftFilters = [this._getBandFilter(0),this._getBandFilter(1),this._getBandFilter(2)]
    this.rightFilter = this._getBandFilter(0)

    const analyzeBuffer = this._analyzeBuffer.bind(this)

    this.through = through(function (packet, enc, cb) {
      const stream = this
      analyzeBuffer(stream, packet, cb)
    })
  }

  getAnalyzer () {
    return this.through
  }

  _analyzeBuffer (stream, packet, done) {
    for (let i = 0; i < packet.length; i += 4) {
      const left = packet.readInt16LE(i)
      const peaks = []
      for(var x=0;x<3;x++) {
        const filteredLeft = this.leftFilters[x].singleStep(left)
        if (this._isPeak(filteredLeft, x)) {
          let ms = Math.round(this.pos[x] / (FREQ / 1000))
          peaks.push({x,ms,pos:this.pos[x]})
          if (this.scheduler) this.scheduler(ms)
        }
        if (this.debugFilter  === x) {
          const right = packet.readInt16LE(i + 2)
          const filteredRight = this.rightFilter.singleStep(right)

          packet.writeInt16LE(filteredLeft, i)
          packet.writeInt16LE(filteredRight, i + 2)
        }

      }
      if(peaks.length > 0) {
        stream.emit('peaks-detected', peaks)
      }

    }

    stream.push(packet)
    done()
  }

  _isPeak (sample, x) {
    let isPeak = false
    this.threshold = Math.max(
      this.slidingWindowMax[x].add(sample) * this.sensitivity,
      this.minThreashold
    )

    const overThreshold = sample >= this.threshold
    const enoughTimeSinceLastPeak = this.lastPeakDistance[x] > MIN_PEAK_DISTANCE
    if (overThreshold && enoughTimeSinceLastPeak) {
      this.bpm[x] = Math.round(60 * FREQ / this.lastPeakDistance[x])
      this.lastPeakDistance[x] = 0
      return true
    }

    if (this.plotter) {
      this.plotter({sample, threshold: this.threshold, lastPeakDistance: this.lastPeakDistance})
    }

    this.pos[x]++
    this.lastPeakDistance[x]++
    if (this.lastPeakDistance[x] > MAX_UINT32) this.lastPeakDistance[x] = MAX_UINT32

    return false
  }

  _getBandFilter (x) {
    const firCalculator = new Fili.FirCoeffs()
/*
    const firFilterCoeffs = firCalculator.lowpass({
      order: 100,
      Fs: FREQ,
      Fc: 100,
    })
*/
    const config = [
      {
        order: 100,
        Fs: FREQ,
        F1: 20,
        F2: 500
      },{
        order: 100,
        Fs: FREQ,
        F1: 300,
        F2: 2000
      },{
        order: 100,
        Fs: FREQ,
        F1: 2000,
        F2: 22000
      }
    ]
    const firFilterCoeffs = firCalculator.bandpass(config[x])

    return new Fili.FirFilter(firFilterCoeffs)
  }

}

module.exports = MusicBeatDetector
