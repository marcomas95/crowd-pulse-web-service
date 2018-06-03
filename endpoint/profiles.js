'use strict';

var qSend = require('../lib/expressQ').send;
var qErr = require('../lib/expressQ').error;
var router = require('express').Router();
var CrowdPulse = require('./../crowd-pulse-data');
var config = require('./../lib/config');

const DB_PROFILES = "profiles";

module.exports = function() {

    /**
     * Get the graph profiles
     * Params:
     *    db - the database name
     *    username - the user name
     */
    router.route('/profiles')
    // /api/profiles?db=profile&username=rstanziale
        .get(function(req, res) {
            var dbConn = new CrowdPulse();
            return dbConn.connect(config.database.url, req.query.db)
                .then(function(conn) {
                    return conn.Profile.search(req.query.username);
                })
                .then(function(objects) {
                    return objects.map(function(item) {
                        return item.username;
                    });
                })
                .then(qSend(res))
                .catch(qErr(res))
                .finally(function() {
                    dbConn.disconnect();
                });
        });

    /**
     * Get the authenticated logged user.
     * Params:
     *    username - the user name
     */
    router.route('/user')
        .post(function(req, res) {
            if (req.body.username !== req.session.username) {
                res.status(401);
                res.json({
                    auth: false,
                    message: 'You do not have the required permissions.'
                });
            } else {
                var dbConn = new CrowdPulse();
                return dbConn.connect(config.database.url, DB_PROFILES)
                    .then(function (conn) {
                        return conn.Profile.findOne({username: req.body.username}, function (err, user) {
                            if (user) {
                                return user;
                            } else {
                                res.status(404);
                                res.json({
                                    auth: true,
                                    message: 'Username not found.'
                                });
                            }
                        });
                    })
                    .then(qSend(res))
                    .catch(qErr(res))
                    .finally(function () {
                        dbConn.disconnect();
                    });
            }
        });

    /**
     * Get public information associated with a user's profile (including holistic profile data).
     * Params:
     *    username - the user name
     *    l - the limit of querying result
     *    fromDate, toDate - temporal filter in date format
     *    c - the specific collection
     *
     *    mode - JSON or JSON-LD
     */
    router.route('/profile/:username')
        .get(function (req, res) {
            // FILTER:
            // Limit (req.query.l):
            let l = Number.MAX_SAFE_INTEGER;

            if(req.query.l) {
                l = req.query.l;
            }

            // fromDate and toDate (req.query.from and req.query.to):
            let temporalFilter = {
                date: "",
                timestamp: ""
            };

            if(req.query.fromDate) {
                temporalFilter.date = "$gte: ISODate(\"" + req.query.fromDate + "\")";
                temporalFilter.timestamp = "$gte: " + Math.round(new Date(req.query.fromDate).getTime()/1000.0);
            }
            if(req.query.toDate) {
                if (temporalFilter.date) {
                    temporalFilter.date += ", $lte: ISODate(\"" + req.query.toDate + "\")";
                }
                else {
                    temporalFilter.date += "$lte: ISODate(\"" + req.query.toDate + "\")";
                }

                if (temporalFilter.timestamp) {
                    temporalFilter.timestamp += ", $lte: " + Math.round(new Date(req.query.toDate).getTime()/1000.0);
                }
                else {
                    temporalFilter.timestamp += "$lte: " + Math.round(new Date(req.query.toDate).getTime()/1000.0);
                }
            }

            // CollectionType (req.query.c):
            let c = "all";

            if(req.query.c) {
                c = req.query.c;
            }

            if (req.params.username) {
                let dbConn = new CrowdPulse();

                // JSON pattern
                let myData = {
                    user: req.params.username,

                    demographics: "Information not shared by the user", // From Profile.demographics collection
                    affects: "Information not shared by the user", // From Message (Sentiment + Emotion) collection
                    behavior: "Information not shared by the user", // From Message (Text, Long, Lat and Date) collection
                    cognitiveAspects: {
                        personalities: "Information not shared by the user",
                        empathies: "Information not shared by the user"
                    }, // From Profile.personalities and Profile.empathies collection
                    interest: "Information not shared by the user", // From Interest collection
                    physicalState: {
                        heart: "Information not shared by the user",
                        sleep: "Information not shared by the user",
                        food: "Information not shared by the user",
                        body: "Information not shared by the user"
                    }, // From PersonalData, heart-rate and sleep
                    socialRelations: "Information not shared by the user" // From Connection collection
                };

                // Save holistic configuration from user's profile
                let holisticConfig = null;

                // Use multiple connections like this
                return dbConn.connect(config.database.url, DB_PROFILES)
                    .then(function (conn) {
                        return conn.Profile.findOne({username: req.params.username}, function (err, user) {
                            if (user) {

                                // Get user configuration
                                holisticConfig = user.identities.configs.holisticProfileConfig;

                                // Get username
                                myData.user = req.params.username;

                                if(c === "all" || c === "Demographics") {
                                    // GET USER DEMOGRAPHICS COLLECTION
                                    if (holisticConfig.shareDemographics) {
                                        if (user.demographics) {
                                            myData.demographics = user.demographics;
                                        }
                                        else myData.demographics = "Missing information";
                                    }
                                }

                                if(c === "all" || c === "CognitiveAspects") {
                                    // GET USER COGNITIVE ASPECTS COLLECTION
                                    if (holisticConfig.shareCognitiveAspects) {
                                        if (user.personalities) {
                                            myData.cognitiveAspects.personalities = user.personalities.slice(0, parseInt(l));
                                            myData.cognitiveAspects.empathies = user.empathies.slice(0, parseInt(l));
                                        }
                                        else myData.cognitiveAspects = "Missing information";
                                    }
                                }

                                dbConn.disconnect();
                            }
                        })
                    })
                    // GET USER AFFECTS COLLECTION
                    .then(function () {
                        if(c === "all" || c === "Affects") {
                            if (holisticConfig.shareAffects) {
                                return dbConn.connect(config.database.url, myData.user)
                                    .then(function (connection) {
                                        return connection.Message.find({}, {
                                            _id: 0,
                                            date: 1,
                                            sentiment: 1,
                                            emotion: 1
                                        }, function (err, profile) {
                                            if (profile) {
                                                myData.affects = profile;
                                            }
                                            else myData.affects = "Missing information";
                                        }).limit(parseInt(l));
                                    })
                                    .finally(function () {
                                        dbConn.disconnect();
                                    })
                            }
                        }
                    })
                    // GET USER BEHAVIOR COLLECTION
                    // TODO: AGGIUNGERE ACTIVITY DI FITBIT IN BEHAVIOR
                    .then(function () {
                        if(c === "all" || c === "Behavior") {
                            if (holisticConfig.shareBehavior) {
                                return dbConn.connect(config.database.url, myData.user)
                                    .then(function (connection) {
                                        return connection.Message.find({}, {
                                            _id: 0,
                                            text: 1,
                                            latitude: 1,
                                            longitude: 1,
                                            date: 1
                                        }, function (err, profile) {
                                            if (profile) {
                                                myData.behavior = profile;
                                            }
                                            else myData.behavior = "Missing information";
                                        }).limit(parseInt(l));
                                    })
                                    .finally(function () {
                                        dbConn.disconnect();
                                    })
                            }
                        }
                    })
                    // GET USER INTERESTS COLLECTION
                    .then(function () {
                        if(c === "all" || c === "Interest") {
                            if (holisticConfig.shareInterest) {
                                return dbConn.connect(config.database.url, myData.user)
                                    .then(function (connection) {
                                        return connection.Interest.find({}, {
                                            _id: 0,
                                            value: 1,
                                            confidence: 1,
                                            timestamp: 1
                                        }, function (err, profile) {
                                            if (profile) {
                                                myData.interest = profile;
                                            }
                                            else myData.interest = "Missing information";
                                        }).limit(parseInt(l));
                                    })
                                    .finally(function () {
                                        dbConn.disconnect();
                                    })
                            }
                        }
                    })
                    // GET USER PHYSICAL STATE COLLECTION
                    .then(function () {
                        if(c === "all" || c === "PhysicalState") {
                            if (holisticConfig.sharePhysicalState) {
                                return dbConn.connect(config.database.url, myData.user)
                                    // TAKE HEART-RATE VALUES
                                    .then(function (connection) {
                                        return connection.PersonalData.find({source: /fitbit-heart/}, {
                                            _id: 0,
                                            timestamp: 1,
                                            restingHeartRate: 1,
                                            peak_minutes: 1,
                                            cardio_minutes: 1,
                                            fatBurn_minutes: 1,
                                            outOfRange_minutes: 1
                                        }, function (err, profile) {
                                            if (profile) {
                                                myData.physicalState.heart = profile;
                                            }
                                            else myData.physicalState.heart = "Missing information";
                                        }).limit(parseInt(l));
                                    })
                                    // TAKE SLEEP VALUES
                                    .then(function () {
                                        return dbConn.connect(config.database.url, myData.user)
                                            .then(function (connection) {
                                                return connection.PersonalData.find({source: /fitbit-sleep/}, {
                                                    _id: 0,
                                                    timestamp: 1,
                                                    duration: 1,
                                                    efficiency: 1,
                                                    minutesAfterWakeup: 1,
                                                    minutesAsleep: 1,
                                                    minutesAwake: 1,
                                                    minutesToFallAsleep: 1,
                                                    timeInBed: 1,
                                                }, function (err, profile) {
                                                    if (profile) {
                                                        myData.physicalState.sleep = profile;
                                                    }
                                                    else myData.physicalState.sleep = "Missing information";
                                                }).limit(parseInt(l));
                                            })
                                    })
                                    // TAKE FOOD VALUES
                                    .then(function () {
                                        return dbConn.connect(config.database.url, myData.user)
                                            .then(function (connection) {
                                                return connection.PersonalData.find({source: /fitbit-food/}, {
                                                    _id: 0,
                                                    timestamp: 1,
                                                    caloriesIn: 1,
                                                    calories: 1,
                                                    carbs: 1,
                                                    fat: 1,
                                                    fiber: 1,
                                                    protein: 1,
                                                    sodium: 1,
                                                    water: 1,
                                                }, function (err, profile) {
                                                    if (profile) {
                                                        myData.physicalState.food = profile;
                                                    }
                                                    else myData.physicalState.food = "Missing information";
                                                }).limit(parseInt(l));
                                            })
                                    })
                                    // TAKE BODY VALUES
                                    .then(function () {
                                        return dbConn.connect(config.database.url, myData.user)
                                            .then(function (connection) {
                                                return connection.PersonalData.find({source: /fitbit-body/}, {
                                                    _id: 0,
                                                    timestamp: 1,
                                                    bodyFat: 1,
                                                    bodyWeight: 1,
                                                    bodyBmi: 1,
                                                    nameBody: 1
                                                }, function (err, profile) {
                                                    if (profile) {
                                                        myData.physicalState.body = profile;
                                                    }
                                                    else myData.physicalState.body = "Missing information";
                                                }).limit(parseInt(l));
                                            })
                                    })
                                    .finally(function () {
                                        dbConn.disconnect();
                                    })
                            }
                        }
                    })
                    // GET USER SOCIAL RELATIONS COLLECTION
                    .then(function () {
                        if(c === "all" || c === "SocialRelations") {
                            if (holisticConfig.shareSocialRelations) {
                                return dbConn.connect(config.database.url, myData.user)
                                    .then(function (connection) {
                                        return connection.Connection.find({}, {
                                            _id: 0,
                                            contactId: 1,
                                            source: 1
                                        }, function (err, profile) {
                                            if (profile) {
                                                myData.socialRelations = profile;
                                            }
                                            else myData.socialRelations = "Missing information";
                                        }).limit(parseInt(l));
                                    })
                                    .finally(function () {
                                        dbConn.disconnect();
                                    })
                            }
                        }

                    })
                    .catch(qErr(res))
                    .finally(function () {

                        res.status(200);
                        res.json(myData);

                        dbConn.disconnect();
                    });

            }
            res.status(404);
            res.json({
                auth: true,
                message: 'Username not found.'
            });
        });

    /**
     * Change holistic profile configuration for the logged user.
     * Post params:
     *    username - the user name
     * Get query params:
     *     shareDemographics, shareInterest, shareAffects, shareCognitiveAspects, shareBehavior,
     *     shareSocialRelations, sharePhysicalState
     */
    router.route('/user/config')
        .post(function(req, res) {
            if (req.body.username !== req.session.username) {
                res.status(401);
                res.json({
                    auth: false,
                    message: 'You do not have the required permissions.'
                });
            } else {
                var dbConn = new CrowdPulse();
                return dbConn.connect(config.database.url, DB_PROFILES)
                    .then(function (conn) {
                        return conn.Profile.findOne({username: req.body.username}, function (err, user) {
                            if (user) {
                                var params = req.query;
                                var config = user.identities.configs.holisticProfileConfig;
                                if (params.shareDemographics !== null && params.shareDemographics !== undefined) {
                                    config.shareDemographics = params.shareDemographics;
                                }
                                if (params.shareInterest !== null && params.shareInterest !== undefined) {
                                    config.shareInterest = params.shareInterest;
                                }
                                if (params.shareAffects !== null && params.shareAffects !== undefined) {
                                    config.shareAffects = params.shareAffects;
                                }
                                if (params.shareCognitiveAspects !== null && params.shareCognitiveAspects !== undefined) {
                                    config.shareCognitiveAspects = params.shareCognitiveAspects;
                                }
                                if (params.shareBehavior !== null && params.shareBehavior !== undefined) {
                                    config.shareBehavior = params.shareBehavior;
                                }
                                if (params.shareSocialRelations !== null && params.shareSocialRelations !== undefined) {
                                    config.shareSocialRelations = params.shareSocialRelations;
                                }
                                if (params.sharePhysicalState !== null && params.sharePhysicalState !== undefined) {
                                    config.sharePhysicalState = params.sharePhysicalState;
                                }

                                // save user config
                                user.save().then(function () {
                                    dbConn.disconnect();
                                });
                                res.status(200);
                                res.json({auth: true});

                            } else {
                                dbConn.disconnect();
                                res.status(404);
                                res.json({
                                    auth: true,
                                    message: 'Username not found.'
                                });
                            }
                        });
                    });
            }
        });

    return router;
};